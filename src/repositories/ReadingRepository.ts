/* eslint-disable no-null/no-null -- SQL parameter nulls disable optional filters. */
import {PoolClient} from "pg";
import {PostgresAdapter} from "(src)/db/PostgresAdapter";
import {fingerprint, ReadingError, Representation} from "(src)/services/ReadingSource";

export interface ReadingIdentity {userId: string; sessionId: string}
export function snapshot(item: any): any {
	return {id: item.id, name: item.name, parentPath: item.parentPath, parentHash: item.parentHash,
		coverId: item.coverId, fileKind: item.fileKind, size: item.size, customDetails: item.customDetails,
		// Preserve the existing catalogue metadata contract.
		// eslint-disable-next-line @typescript-eslint/naming-convention
		localDetails: {title: item.localDetails?.title, "author(s)": item.localDetails?.["author(s)"]},
		// eslint-disable-next-line @typescript-eslint/naming-convention
		webDetails: {title: item.webDetails?.title, author_name: item.webDetails?.author_name, cover_i: item.webDetails?.cover_i}};
}
export class ReadingRepository {
	private get pool() {
		return PostgresAdapter.getInstance().pool;
	}
	async transaction<T>(identity: ReadingIdentity, work: (client: PoolClient) => Promise<T>, exclusive = false): Promise<T> {
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");
			await client.query("SET LOCAL lock_timeout='3s'");
			// Conflicts with login/logout updates to users.session_id, unlike FOR KEY SHARE.
			const user = await client.query(`SELECT id FROM users WHERE id=$1 AND session_id=$2 AND is_active=true FOR ${exclusive ? "UPDATE" : "SHARE"}`, [identity.userId, identity.sessionId]);
			const session = await client.query(`SELECT sid FROM session WHERE sid=$1 AND expire>now()
                AND sess->>'userId'=$2 AND (sess->>'lastActivity')::numeric > extract(epoch from clock_timestamp())*1000-3600000`, [identity.sessionId, identity.userId]);
			if (!user.rowCount || !session.rowCount) throw new ReadingError(401, "SESSION_INVALIDATED");
			const result = await work(client); await client.query("COMMIT"); return result;
		} catch (error) {
			await client.query("ROLLBACK"); throw error;
		} finally {
			client.release();
		}
	}
	private async history(client: PoolClient, user: string, item: any, operation: string, visit: boolean): Promise<any> {
		const present = await client.query('SELECT id FROM archive WHERE id=$1 AND name=$2 AND "parentPath"=$3 FOR KEY SHARE', [item.id, item.name, item.parentPath]);
		if (!present.rowCount) throw new ReadingError(409, "MATERIAL_CHANGED");
		const {rows} = await client.query(`INSERT INTO reading_history(user_id,original_archive_id,archive_id,snapshot,last_visit_operation)
            VALUES($1,$2,$2,$3,$4) ON CONFLICT(user_id,original_archive_id) DO UPDATE SET
            last_visited_at=CASE WHEN $5 AND reading_history.last_visit_operation<>$4 THEN now() ELSE reading_history.last_visited_at END,
            visits=reading_history.visits+CASE WHEN $5 AND reading_history.last_visit_operation<>$4 THEN 1 ELSE 0 END,
            last_visit_operation=CASE WHEN $5 THEN $4 ELSE reading_history.last_visit_operation END
            RETURNING *`, [user, item.id, snapshot(item), operation, visit]);
		return rows[0];
	}
	async visit(identity: ReadingIdentity, item: any, operation: string): Promise<any> {
		return this.transaction(identity, client => this.history(client, identity.userId, item, operation, true));
	}
	async progress(user: string, archive: number, rep: Representation): Promise<any> {
		const {rows} = await this.pool.query(`SELECT p.* FROM reading_progress p JOIN reading_history h ON h.id=p.history_id
            WHERE h.user_id=$1 AND h.original_archive_id=$2 AND p.representation=$3`, [user, archive, rep]);
		return rows[0];
	}
	async save(identity: ReadingIdentity, item: any, rep: Representation, input: any): Promise<any> {
		return this.transaction(identity, async client => {
			const history = await this.history(client, identity.userId, item, input.operationId, false);
			const previous = (await client.query("SELECT * FROM reading_progress WHERE history_id=$1 AND representation=$2 FOR UPDATE", [history.id, rep])).rows[0];
			const hash = fingerprint([input.sourceRevision, input.position, input.expectedRevision]);
			if (previous?.last_operation === input.operationId) {
				if (previous.operation_hash !== hash) throw new ReadingError(409, "OPERATION_REUSED");
				return previous;
			}
			if ((previous?.revision ?? 0) !== input.expectedRevision) throw new ReadingError(409, "PROGRESS_CONFLICT");
			const {rows} = await client.query(`INSERT INTO reading_progress(history_id,representation,source_revision,position,last_operation,operation_hash)
                VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(history_id,representation) DO UPDATE SET
                source_revision=$3,position=$4,last_operation=$5,operation_hash=$6,revision=reading_progress.revision+1,updated_at=now() RETURNING *`,
			[history.id, rep, input.sourceRevision, input.position, input.operationId, hash]);
			await client.query("UPDATE reading_history SET last_visited_at=now() WHERE id=$1", [history.id]);
			return rows[0];
		});
	}
	private historyFilter(after: boolean): string {
		return `FROM reading_history h LEFT JOIN archive a ON a.id=h.archive_id
            WHERE h.user_id=$1 AND ($2='recent' OR EXISTS(SELECT 1 FROM reading_progress p WHERE p.history_id=h.id))
            AND ($3='' OR EXISTS(SELECT 1 FROM reading_progress p WHERE p.history_id=h.id AND p.representation=$3))
            AND ($6='' OR COALESCE(CASE WHEN a.name=h.snapshot->>'name' AND a."parentPath"=h.snapshot->>'parentPath'
                THEN a."fileKind"::text ELSE h.snapshot->>'fileKind' END,'NONE')=$6)
            AND ($4::timestamptz IS NULL OR (h.last_visited_at,h.id)${after ? ">" : "<"}($4::timestamptz,$5::uuid))`;
	}
	async list(user: string, mode: string, rep: string, cursor?: {at: string; id: string}, kind = "", after = false): Promise<any[]> {
		const order = after ? "ASC" : "DESC";
		const {rows} = await this.pool.query(`SELECT h.*,h.last_visited_at::text AS cursor_at,a.id AS live_id,to_jsonb(a) AS live_item,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('representation',p.representation,'position',p.position,'updatedAt',p.updated_at)
                ORDER BY p.updated_at DESC) FROM reading_progress p WHERE p.history_id=h.id),'[]') AS progress
            ${this.historyFilter(after)} ORDER BY h.last_visited_at ${order},h.id ${order} LIMIT 21`,
		[user, mode, rep, cursor?.at ?? null, cursor?.id ?? null, kind]);
		return rows;
	}
	async hasHistory(user: string, mode: string, rep: string, cursor: {at: string; id: string}, kind: string, after: boolean): Promise<boolean> {
		const {rows} = await this.pool.query(`SELECT 1 ${this.historyFilter(after)} LIMIT 1`, [user, mode, rep, cursor.at, cursor.id, kind]);
		return rows.length > 0;
	}
	async preferences(user: string): Promise<any> {
		const {rows} = await this.pool.query("SELECT prefs->'reading' AS settings FROM users WHERE id=$1", [user]);
		return rows[0]?.settings ?? {revision: 0, values: {}};
	}
	async savePreferences(identity: ReadingIdentity, expected: number, patch: any): Promise<any> {
		return this.transaction(identity, async client => {
			// Serialize field-wise preference updates as well as concurrent first writes.
			const {rows} = await client.query("SELECT prefs FROM users WHERE id=$1 FOR UPDATE", [identity.userId]);
			const prefs = rows[0].prefs ?? {}, reading = prefs.reading ?? {revision: 0, values: {}};
			if (reading.revision !== expected) throw new ReadingError(409, "PREFERENCES_CONFLICT");
			const values = {...reading.values};
			for (const key of Object.keys(patch)) values[key] = {...values[key], ...patch[key]};
			const next = {revision: expected + 1, values};
			await client.query("UPDATE users SET prefs=$2 WHERE id=$1", [identity.userId, {...prefs, reading: next}]);
			return next;
		}, true);
	}
}

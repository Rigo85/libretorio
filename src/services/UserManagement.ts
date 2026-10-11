/* eslint-disable no-null/no-null -- Nullable SQL bounds and JSON pagination contract. */
import {hash, verify} from "@node-rs/argon2";
import {Pool, PoolClient} from "pg";
import {sessionRevocations} from "./SessionRevocation";

export class UserManagementError extends Error {
	constructor(public status: number, public code: string) {
		super(code);
	}
}
export interface UserIdentity {userId: string; sessionId: string}
const fail = (status: number, code: string): never => {
	throw new UserManagementError(status, code);
};
export function userEmail(value: unknown): string {
	if (typeof value !== "string") return fail(400, "INVALID_EMAIL");
	const email = value.trim().toLowerCase();
	if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, "INVALID_EMAIL");
	return email;
}
export function userPassword(value: unknown): string {
	if (typeof value !== "string" || Array.from(value).length < 15 || value.length > 256 || !value.trim()) return fail(400, "INVALID_PASSWORD");
	return value;
}
export function userId(value: unknown): string {
	if (typeof value !== "string" || !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value)) return fail(400, "INVALID_USER_ID");
	return value;
}
function revision(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) return fail(400, "INVALID_REVISION");
	return Number(value);
}
function boolean(value: unknown): boolean {
	if (typeof value !== "boolean") return fail(400, "INVALID_USER"); return value;
}
function fields(body: any, allowed: string[]): void {
	if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) fail(400, "INVALID_USER");
}
const publicColumns = 'u.id,u.email,u.is_admin AS "isAdmin",u.is_active AS "isActive",u.created_at AS "createdAt",u.management_revision AS revision';

export class UserManagement {
	constructor(private pool: Pool) {}
	private async actor(db: Pool | PoolClient, identity: UserIdentity, admin: boolean): Promise<any> {
		const {rows} = await db.query(`SELECT u.id,u.password_hash,u.is_admin FROM users u JOIN session s ON s.sid=u.session_id
            WHERE u.id=$1 AND u.session_id=$2 AND u.is_active=true AND s.expire>now()
            AND s.sess->>'userId'=u.id::text
            AND (s.sess->>'lastActivity')::numeric > extract(epoch from clock_timestamp())*1000-3600000`, [identity.userId, identity.sessionId]);
		if (!rows[0]) return fail(401, "SESSION_INVALIDATED");
		if (admin && !rows[0].is_admin) return fail(403, "ADMIN_REQUIRED");
		return rows[0];
	}
	async authorize(identity: UserIdentity): Promise<void> {
		await this.actor(this.pool, identity, true);
	}
	async list(identity: UserIdentity, query: any): Promise<any> {
		await this.authorize(identity);
		const q = query.q ?? "", state = query.state ?? "", before = query.before;
		if (typeof q !== "string" || q.length > 254 || typeof state !== "string" || !["", "active", "inactive"].includes(state)) fail(400, "INVALID_FILTER");
		if (before !== undefined) userId(before);
		const {rows} = await this.pool.query(`SELECT ${publicColumns},
            (SELECT max(logged_at) FROM user_logins WHERE user_id=u.id) AS "lastLogin"
            FROM users u WHERE ($1='' OR position($1 in lower(u.email))>0)
            AND ($2='' OR u.is_active=($2='active')) AND ($3::uuid IS NULL OR u.id<$3)
            ORDER BY u.id DESC LIMIT 21`, [q.trim().toLowerCase(), state, before ?? null]);
		return {items: rows.slice(0, 20), next: rows.length > 20 ? rows[19].id : null};
	}
	private async mutation(identity: UserIdentity, password: unknown, admin: boolean,
		work: (db: PoolClient) => Promise<{result: any; revoked?: string}>): Promise<any> {
		const before = await this.actor(this.pool, identity, admin);
		if (typeof password !== "string" || password.length > 256 || !await verify(before.password_hash, password)) fail(403, "REAUTHENTICATION_FAILED");
		const db = await this.pool.connect(); let value: {result: any; revoked?: string};
		try {
			await db.query("BEGIN"); await db.query("SET LOCAL lock_timeout='5s'");
			// Serialize administrative writes, including the last-admin invariant across two accounts.
			await db.query("SELECT pg_advisory_xact_lock(716043, 1)");
			await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [identity.userId]);
			const current = await this.actor(db, identity, admin);
			if (current.password_hash !== before.password_hash) fail(409, "USER_CHANGED");
			value = await work(db); await db.query("COMMIT");
		} catch (error) {
			await db.query("ROLLBACK");
			if (error.code === "23505") fail(409, "EMAIL_EXISTS");
			throw error;
		} finally {
			db.release();
		}
		if (value.revoked) sessionRevocations.emit("revoked", value.revoked);
		return {...value.result, selfRevoked: value.revoked === identity.sessionId};
	}
	private async audit(db: PoolClient, actor: string, target: string, action: string, changes: any): Promise<void> {
		await db.query("INSERT INTO audit_logs(user_id,entity_name,entity_id,action,changes) VALUES($1,'users',$2,$3,$4)", [actor, target, action, changes]);
	}
	async create(identity: UserIdentity, body: any): Promise<any> {
		fields(body, ["email", "password", "isAdmin", "isActive", "adminPassword"]);
		const email = userEmail(body.email), password = userPassword(body.password), isAdmin = boolean(body.isAdmin), isActive = boolean(body.isActive);
		return this.mutation(identity, body.adminPassword, true, async db => {
			const {rows} = await db.query("INSERT INTO users(email,password_hash,is_admin,is_active) VALUES($1,$2,$3,$4) RETURNING id", [email, await hash(password), isAdmin, isActive]);
			await this.audit(db, identity.userId, rows[0].id, "user_created", {email, isAdmin, isActive});
			return {result: {id: rows[0].id}};
		});
	}
	async update(identity: UserIdentity, id: unknown, body: any, action: "edit" | "password" | "revoke"): Promise<any> {
		const target = userId(id);
		fields(body, action === "edit" ? ["email", "isAdmin", "isActive", "expectedRevision", "adminPassword"] :
			action === "password" ? ["password", "expectedRevision", "adminPassword"] : ["expectedRevision", "adminPassword"]);
		const expected = revision(body.expectedRevision);
		const edit = action === "edit" ? {email: userEmail(body.email), isAdmin: boolean(body.isAdmin), isActive: boolean(body.isActive)} : undefined;
		const password = action === "password" ? userPassword(body.password) : undefined;
		return this.mutation(identity, body.adminPassword, true, async db => {
			const old = (await db.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [target])).rows[0];
			if (!old) return fail(404, "USER_NOT_FOUND");
			if (old.management_revision !== expected) return fail(409, "USER_CHANGED");
			if (edit && old.is_admin && old.is_active && (!edit.isAdmin || !edit.isActive)) {
				const admins = await db.query("SELECT id FROM users WHERE is_admin=true AND is_active=true AND id<>$1 LIMIT 1", [target]);
				if (!admins.rowCount) fail(409, "LAST_ADMIN");
			}
			if (edit) await db.query("UPDATE users SET email=$2,is_admin=$3,is_active=$4,session_id=NULL,management_revision=management_revision+1 WHERE id=$1", [target, edit.email, edit.isAdmin, edit.isActive]);
			else if (password) await db.query("UPDATE users SET password_hash=$2,session_id=NULL,management_revision=management_revision+1 WHERE id=$1", [target, await hash(password)]);
			else await db.query("UPDATE users SET session_id=NULL,management_revision=management_revision+1 WHERE id=$1", [target]);
			if (old.session_id) await db.query("DELETE FROM session WHERE sid=$1", [old.session_id]);
			await this.audit(db, identity.userId, target, {edit: "user_updated", password: "password_reset", revoke: "session_revoked"}[action],
				edit ? {before: {email: old.email, isAdmin: old.is_admin, isActive: old.is_active}, after: edit} : {});
			return {result: {id: target, revision: expected + 1}, revoked: old.session_id};
		});
	}
	async changePassword(identity: UserIdentity, body: any): Promise<any> {
		fields(body, ["currentPassword", "password"]); const password = userPassword(body.password);
		return this.mutation(identity, body.currentPassword, false, async db => {
			await db.query("UPDATE users SET password_hash=$2,session_id=NULL,management_revision=management_revision+1 WHERE id=$1", [identity.userId, await hash(password)]);
			await db.query("DELETE FROM session WHERE sid=$1", [identity.sessionId]);
			await this.audit(db, identity.userId, identity.userId, "password_changed", {});
			return {result: {}, revoked: identity.sessionId};
		});
	}
}

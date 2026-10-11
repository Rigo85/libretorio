import { Logger } from "(src)/helpers/Logger";
import { PostgresAdapter } from "(src)/db/PostgresAdapter";

const logger = new Logger("AuditLogsRepository");

export class AuditLogsRepository {
	private static instance: AuditLogsRepository;

	private constructor() {}

	public static getInstance(): AuditLogsRepository {
		if (!AuditLogsRepository.instance) {
			AuditLogsRepository.instance = new AuditLogsRepository();
		}
		return AuditLogsRepository.instance;
	}

	public async insert(userId: string, entityName: string, entityId: string | number, action: string, changes: Record<string, any> = {}): Promise<void> {
		logger.info(`insert: userId="${userId}", entityName="${entityName}", entityId="${entityId}", action="${action}"`);
		try {
			const query = `
                INSERT INTO audit_logs (user_id, entity_name, entity_id, action, changes)
                VALUES ($1, $2, $3, $4, $5)
			`;
			// archive.id is numeric; entity_id was created for UUID-based entities.
			const uuid = typeof entityId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entityId)
				? entityId : undefined;
			const archiveId = typeof entityId === "number" && Number.isSafeInteger(entityId) && entityId > 0
				? entityId : typeof entityId === "string" && /^[1-9]\d*$/.test(entityId) && Number.isSafeInteger(Number(entityId))
					? Number(entityId) : undefined;
			const details = uuid || entityId === undefined ? changes : archiveId !== undefined
				? {...changes, archiveId} : {...changes, entityId};
			const values = [userId, entityName, uuid, action, JSON.stringify(details)];
			await PostgresAdapter.getInstance().query(query, values);
		} catch (error) {
			logger.error("insert", error.message);
		}
	}
}

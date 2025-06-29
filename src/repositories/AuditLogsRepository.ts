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
			const values = [userId, entityName, entityId, action, JSON.stringify(changes)];
			await PostgresAdapter.getInstance().query(query, values);
		} catch (error) {
			logger.error("insert", error.message);
		}
	}
}

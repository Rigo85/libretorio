import { Logger } from "(src)/helpers/Logger";
import { AuditLogsRepository } from "(src)/repositories/AuditLogsRepository";
import { WebsocketAction } from "(src)/models/interfaces/WebSocketTypes";

const logger = new Logger("AuditLogsService");

export class AuditLogsService {
	private static instance: AuditLogsService;

	private constructor() {}

	public static getInstance(): AuditLogsService {
		if (!AuditLogsService.instance) {
			AuditLogsService.instance = new AuditLogsService();
		}
		return AuditLogsService.instance;
	}

	public async logAction(userId: string, action: WebsocketAction, changes: Record<string, any> = {}): Promise<void> {
		try {
			if ((action as string) == "ping") {
				// No log ping actions
				return;
			} else if (action === "log_action") {
				const {action, entityName, entityId, changes: actionChanges} = changes?.data || {};
				if (action) {
					await AuditLogsRepository.getInstance().insert(userId, entityName, entityId, action, actionChanges);
				} else {
					logger.error(`logAction: "Invalid action data". Data: '${JSON.stringify(changes)}'`);
				}
			} else {
				await AuditLogsRepository.getInstance().insert(userId, "", undefined, action, changes);
			}
		} catch (error) {
			logger.error("logAction", error);
		}
	}
}
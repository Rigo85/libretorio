import { WebSocket } from "ws";
import { UserRepository } from "(src)/repositories/UserRepository";
import { ExtendedWebSocket } from "(src)/models/interfaces/WebSocketTypes";
import { Logger } from "(src)/helpers/Logger";

const logger = new Logger("WebSocket session");

export async function validateSession(ws: ExtendedWebSocket): Promise<boolean> {
	try {
		const current = ws.session?.userId && ws.sessionID
			? await UserRepository.getInstance().getWebSocketSession(ws.session.userId, ws.sessionID)
			: undefined;
		const activity = current?.lastActivity ?? ws.lastActivityTime ?? 0;
		if (!current || Date.now() - activity > 60 * 60 * 1000) {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({event: "session_expired", data: {message: "Your session is no longer valid."}}));
				ws.close(1008, "Session expired");
			}
			return false;
		}
		ws.session.isAdmin = current.isAdmin;
		return ws.readyState === WebSocket.OPEN;
	} catch (error) {
		logger.error("Session validation unavailable", {message: error instanceof Error ? error.message : "Database error"});
		if (ws.readyState === WebSocket.OPEN) ws.close(1013, "Session validation unavailable");
		return false;
	}
}

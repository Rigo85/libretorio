import { Express } from "express";
import { WebSocket, WebSocketServer } from "ws";
import http from "http";
import { Logger } from "(src)/helpers/Logger";
import { onMessageEvent } from "(src)/websocket/websocketRouter";
import { config } from "(src)/config/configuration";
import { ExtendedWebSocket, SessionRequest, WSServerConfig } from "(src)/models/interfaces/WebSocketTypes";
import { UserRepository } from "(src)/repositories/UserRepository";
import { validateSession } from "(src)/websocket/validateSession";
import { sessionRevocations } from "(src)/services/SessionRevocation";

const logger = new Logger("WS Server");

export class WSServer {
	private wss: WebSocketServer;
	private readonly server: http.Server;
	private heartbeatInterval: NodeJS.Timeout | undefined = undefined;
	private revokeSession = (sid: string): void => {
		for (const socket of this.wss.clients) {
			if ((socket as ExtendedWebSocket).sessionID !== sid) continue;
			if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({event: "session_expired", data: {message: "Your session is no longer valid."}}));
			socket.close(1008, "Session revoked");
		}
	};
	private readonly config: Required<WSServerConfig>;

	constructor(app: Express, sessionParser: any, wsServerConfig: WSServerConfig = {}) {
		this.config = {
			pingInterval: wsServerConfig.pingInterval || config.production.websocket.pingInterval,
			upgradeTimeout: wsServerConfig.upgradeTimeout || config.production.websocket.upgradeTimeout,
			shutdownTimeout: wsServerConfig.shutdownTimeout || config.production.websocket.shutdownTimeout
		};

		this.server = http.createServer(app);
		this.wss = new WebSocketServer({noServer: true, maxPayload: 1024 * 1024});
		sessionRevocations.on("revoked", this.revokeSession);

		this.setupServerEvents(sessionParser);
	}

	private setupServerEvents(sessionParser: any): void {
		this.server.on("upgrade", async (req: SessionRequest, socket, head) => {
			logger.info("WebSocket upgrade request received.");
			const upgradeTimeout = setTimeout(() => socket.destroy(), this.config.upgradeTimeout);
			try {
				if (req.headers.origin !== (process.env.ALLOWED_ORIGIN || "https://libretorio.rji-services.org")) {
					socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
					socket.destroy();
					return;
				}

				await new Promise<void>((resolve, reject) => {
					sessionParser(req as any, {} as any, (err: Error | null) => {
						if (err) reject(err);
						else resolve();
					});
				});

				const current = req.session?.userId && req.sessionID
					? await UserRepository.getInstance().getWebSocketSession(req.session.userId, req.sessionID)
					: undefined;
				if (!current || (current.lastActivity !== undefined && Date.now() - current.lastActivity > 60 * 60 * 1000)) {
					logger.error(`Unauthorized connection attempt from ${req.socket.remoteAddress}.`);
					socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
					socket.destroy();
					return;
				}
				if (socket.destroyed) return;

				this.wss.handleUpgrade(req, socket, head, (ws) => {
					const extWs = ws as ExtendedWebSocket;
					extWs.session = req.session!;
					extWs.session.isAdmin = current.isAdmin;
					extWs.sessionID = req.sessionID!;
					extWs.isAlive = true;
					this.wss.emit("connection", extWs, req);
				});
			} catch (error: any) {
				logger.error(`Error during WebSocket upgrade: ${error.message}`);
				if (!socket.destroyed) socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
				socket.destroy();
			} finally {
				clearTimeout(upgradeTimeout);
			}
		});

		this.wss.on("connection", this.handleConnection.bind(this));

		this.wss.on("close", () => {
			sessionRevocations.off("revoked", this.revokeSession);
			this.clearHeartbeat();
		});
	}

	private handleConnection(ws: ExtendedWebSocket): void {
		const {userId, isAdmin} = ws.session;
		logger.info(`Usuario conectado: ${userId}, admin: ${isAdmin}`);

		ws.lastActivityTime = Date.now();

		let checking = false;
		const checkInterval = setInterval(async () => {
			if (checking || ws.readyState !== WebSocket.OPEN) return;
			checking = true;
			try {
				if (!await validateSession(ws)) clearInterval(checkInterval);
			} finally {
				checking = false;
			}
		}, 30000);

		ws.on("pong", () => {
			ws.isAlive = true;
		});

		ws.on("error", (error) => {
			logger.error(`User connection error for ${userId}:`, error);
			clearInterval(checkInterval);
		});

		ws.on("close", () => {
			logger.info(`Client "${userId}" disconnected.`);
			clearInterval(checkInterval);
		});

		let activeMessages = 0;
		let messagesInWindow = 0;
		let windowStart = Date.now();
		ws.on("message", async (message, isBinary) => {
			if (Date.now() - windowStart >= 60_000) {
				windowStart = Date.now();
				messagesInWindow = 0;
			}
			if (isBinary || ++messagesInWindow > 120 || activeMessages >= 4) {
				ws.close(1008, "Message limit exceeded");
				return;
			}
			activeMessages++;
			try {
				await onMessageEvent(message, ws);
			} catch (error) {
				logger.error("WebSocket message failed", error);
				ws.close(1011, "Message failed");
			} finally {
				activeMessages--;
			}
		});
	}

	private startHeartbeat(): void {
		this.clearHeartbeat();

		this.heartbeatInterval = setInterval(() => {
			this.wss.clients.forEach((ws: WebSocket) => {
				const extWs = ws as ExtendedWebSocket;

				if (extWs.isAlive === false) {
					return extWs.terminate();
				}

				extWs.isAlive = false;
				extWs.ping();
			});
		}, this.config.pingInterval);
	}

	private clearHeartbeat(): void {
		if (this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
			this.heartbeatInterval = undefined;
		}
	}

	public listen(port: number): Promise<void> {
		return new Promise((resolve) => {
			this.server.listen(port, () => {
				this.startHeartbeat();
				// logger.success(`Server running on port ${port} in ${config.production.server.environment} mode`);
				resolve();
			});
		});
	}

	public close(): Promise<void> {
		return this.shutdown();
	}

	public shutdown(): Promise<void> {
		return new Promise<void>((resolve) => {
			logger.info("Closing WebSocket server.");
			this.clearHeartbeat();

			const clientCount = this.wss.clients.size;
			if (clientCount > 0) {
				logger.info(`Closing ${clientCount} active connections...`);
			}

			this.wss.clients.forEach((ws: WebSocket) => {
				ws.terminate();
			});

			const shutdownTimeout = setTimeout(() => {
				logger.error("Shutdown timeout exceeded, forcing close.");
				this.forceClose(resolve);
			}, this.config.shutdownTimeout);

			this.wss.close(() => {
				clearTimeout(shutdownTimeout);
				this.server.close(() => {
					logger.info("HTTP and WebSocket servers closed successfully.");
					resolve();
				});
			});
		});
	}

	private forceClose(resolve: () => void): void {
		this.server.close(() => {
			logger.info("Servers forcibly closed.");
			resolve();
		});
	}
}

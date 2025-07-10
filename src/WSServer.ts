import { Express } from "express";
import { WebSocket, WebSocketServer } from "ws";
import http from "http";
import { Logger } from "(src)/helpers/Logger";
import { onMessageEvent } from "(src)/websocket/websocketRouter";
import { config } from "(src)/config/configuration";
import { ExtendedWebSocket, SessionRequest, WSServerConfig } from "(src)/models/interfaces/WebSocketTypes";

const logger = new Logger("WS Server");

export class WSServer {
	private wss: WebSocketServer;
	private readonly server: http.Server;
	private heartbeatInterval: NodeJS.Timeout | undefined = undefined;
	private readonly config: Required<WSServerConfig>;

	constructor(app: Express, sessionParser: any, wsServerConfig: WSServerConfig = {}) {
		this.config = {
			pingInterval: wsServerConfig.pingInterval || config.production.websocket.pingInterval,
			upgradeTimeout: wsServerConfig.upgradeTimeout || config.production.websocket.upgradeTimeout,
			shutdownTimeout: wsServerConfig.shutdownTimeout || config.production.websocket.shutdownTimeout
		};

		this.server = http.createServer(app);
		this.wss = new WebSocketServer({noServer: true});

		this.setupServerEvents(sessionParser);
	}

	private setupServerEvents(sessionParser: any): void {
		this.server.on("upgrade", async (req: SessionRequest, socket, head) => {
			logger.info("WebSocket upgrade request received.");
			try {
				const upgradeTimeout = setTimeout(() => {
					socket.destroy();
					logger.error("WebSocket upgrade timeout exceeded.");
				}, this.config.upgradeTimeout);

				await new Promise<void>((resolve, reject) => {
					sessionParser(req as any, {} as any, (err: Error | null) => {
						if (err) reject(err);
						else resolve();
					});
				});

				clearTimeout(upgradeTimeout);

				if (!req.session?.userId) {
					logger.error(`Unauthorized connection attempt from ${req.socket.remoteAddress}.`);
					socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
					socket.destroy();
					return;
				}

				this.wss.handleUpgrade(req, socket, head, (ws) => {
					const extWs = ws as ExtendedWebSocket;
					extWs.session = req.session!;
					extWs.isAlive = true;
					this.wss.emit("connection", extWs, req);
				});
			} catch (error: any) {
				logger.error(`Error during WebSocket upgrade: ${error.message}`);
				socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
				socket.destroy();
			}
		});

		this.wss.on("connection", this.handleConnection.bind(this));

		this.wss.on("close", () => {
			this.clearHeartbeat();
		});
	}

	private handleConnection(ws: ExtendedWebSocket): void {
		const {userId, isAdmin} = ws.session;
		logger.info(`Usuario conectado: ${userId}, admin: ${isAdmin}`);

		if (!ws.session.lastActivity) {
			ws.session.lastActivity = Date.now();
		}

		const checkInterval = setInterval(() => {
			if (!ws.session ||
				!ws.session.lastActivity ||
				Date.now() - ws.session.lastActivity > 2 * 60 * 60 * 1000) {

				ws.send(JSON.stringify({
					event: "session_expired",
					data: {message: "Your session has expired due to inactivity."}
				}));

				clearInterval(checkInterval);
				ws.close();
			}
		}, 30000); // Verificar cada 30 segundos

		ws.on("pong", () => {
			ws.isAlive = true;
		});

		ws.on("error", (error) => {
			logger.error(`Error en conexión del usuario ${userId}:`, error);
		});

		ws.on("close", () => {
			logger.info(`Cliente "${userId}" desconectado.`);
			clearInterval(checkInterval);
		});

		ws.on("message", async (message) => {
			ws.session.lastActivity = Date.now();
			await onMessageEvent(message, ws);
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

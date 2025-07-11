// Hack to get module importing from typescript correctly translated to node JS (CommonJS)
const moduleAlias = require("module-alias");
moduleAlias.addAliases({
	"@root": __dirname + "/..",
	"(src)": __dirname
});

import { NextFunction, Request, Response } from "express";
import errorHandler from "errorhandler";

import { PostgresAdapter } from "(src)/db/PostgresAdapter";
import { Logger } from "(src)/helpers/Logger";
import { WSServer } from "(src)/WSServer";
import { bootstrap } from "./app";
import { config } from "(src)/config/configuration";

async function fullServerStart() {
	const {app, sessionParser} = await bootstrap();
	if (!app || !sessionParser) {
		throw new Error("Failed to bootstrap the application.");
	}

	const logger = new Logger("server");
	let server: WSServer | undefined = undefined;

	const shutdown = async (signal?: string) => {
		const exitCode = signal ? 0 : 1;
		const reason = signal || "Critical error";

		logger.info(`Starting graceful shutdown. Reason: ${reason}`);

		const forceExit = setTimeout(() => {
			logger.error("Forcing shutdown after timeout");
			process.exit(exitCode);
		}, 10000);

		try {
			if (server) {
				logger.info("Closing HTTP/WebSocket server...");
				await server.close();
			}

			const dbService = PostgresAdapter.getInstance();
			await dbService.disconnect();

			clearTimeout(forceExit);
			logger.success("Graceful shutdown completed");
			process.exit(exitCode);
		} catch (error) {
			logger.error("Error during shutdown:", error);
			process.exit(1);
		}
	};

	if (config.production.server.environment === "development") {
		app.use(errorHandler());
	} else {
		app.use((err: any, req: Request, res: Response, next: NextFunction) => {
			logger.error(err);
			res.status(err.status || 500);
			res.send({error: "Internal Server Error", message: err.message || "An unexpected error occurred."});
		});
	}

	process.on("uncaughtException", (error) => {
		logger.error("Uncaught Exception:", error);
		shutdown().catch(logger.error);
	});

	process.on("unhandledRejection", (reason, promise) => {
		logger.error("Unhandled Rejection:", reason);
		shutdown().catch(logger.error);
	});

	["SIGINT", "SIGTERM"].forEach(signal => {
		process.on(signal, () => {
			logger.info(`Received ${signal}. Shutting down gracefully.`);
			// process.exit(0);
			shutdown(signal).catch(logger.error);
		});
	});

	const startServer = async () => {
		try {
			const port = config.production.server.port;
			const nodeEnv = config.production.server.environment;

			server = new WSServer(app, sessionParser);
			await server.listen(port);
			logger.success(`Server running on port ${port} in ${nodeEnv} mode`);
		} catch (error) {
			logger.error("Error starting server:", error);
			process.exit(1);
		}
	};

	startServer().catch((error) => {
		logger.error("Error in startServer:", error);
		process.exit(1);
	});
}

fullServerStart().catch(console.error);

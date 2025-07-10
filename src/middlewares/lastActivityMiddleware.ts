import { Request, Response, NextFunction } from "express";
import { Logger } from "(src)/helpers/Logger";
import { SessionData } from "(src)/models/interfaces/WebSocketTypes";

const logger = new Logger("LastActivity Middleware");

export async function lastActivityMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
	// logger.info("Checking last activity timestamp...");

	if (req.session) {
		if (!(req.session as SessionData).lastActivity) {
			(req.session as SessionData).lastActivity = Date.now();
		}

		const now = Date.now();
		if (now - (req.session as SessionData).lastActivity > 1 * 60 * 60 * 1000) {
			await new Promise<void>((resolve, reject) => {
				req.session.destroy((err) => {
					if (err) reject(err);
					else resolve();
				});
			});

			// return res.status(401).json({message: "Sesión expirada por inactividad"});
			logger.info("Session expired due to inactivity, redirecting to login.");
			res.redirect("/auth/login");
			return;
		}

		(req.session as SessionData).lastActivity = now;
	}

	next();
}

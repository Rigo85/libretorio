import { Request, Response, NextFunction } from "express";
import { UserRepository } from "(src)/repositories/UserRepository";
import { Logger } from "(src)/helpers/Logger";
import { sessionUnauthorizedResponse } from "./sessionUnauthorizedResponse";

const logger = new Logger("SingleSession Middleware");

export async function singleSessionMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
	if (!req.session?.userId) {
		next();
		return;
	}

	try {
		const storedSessionId = await UserRepository.getInstance().getSessionId(req.session.userId);

		if (storedSessionId !== req.sessionID) {
			await new Promise<void>((resolve, reject) => {
				req.session.destroy((err) => {
					if (err) reject(err);
					else resolve();
				});
			});
			sessionUnauthorizedResponse(req, res, "Session has been invalidated by a login from another device.", "SESSION_INVALIDATED");
			return;
		}

		next();
	} catch (error) {
		logger.error("Error in session validation:", error);
		res.setHeader("Cache-Control", "private, no-store");
		res.status(503).json({error: "Service temporarily unavailable."});
		return;
	}
}

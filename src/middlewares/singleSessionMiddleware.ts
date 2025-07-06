import { Request, Response, NextFunction } from "express";
import { UserRepository } from "(src)/repositories/UserRepository";
import { Logger } from "(src)/helpers/Logger";

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
			// res.status(401).json({error: "Session has been invalidated by a login from another device."});
			res.redirect("/auth/login");
			return;
		}

		next();
	} catch (error) {
		logger.error("Error in session validation:", error);
		next();
	}
}

import { Request, Response, NextFunction } from "express";
import { Logger } from "(src)/helpers/Logger";
import { SessionData } from "(src)/models/interfaces/WebSocketTypes";
import { sessionUnauthorizedResponse } from "./sessionUnauthorizedResponse";

const logger = new Logger("LastActivity Middleware");

export async function lastActivityMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
	// logger.info("Checking last activity timestamp...");

	if (req.session?.userId) {
		if (!(req.session as SessionData).lastActivity) {
			(req.session as SessionData).lastActivity = Date.now();
		}

		const now = Date.now();
		if (now - (req.session as SessionData).lastActivity > 1 * 60 * 60 * 1000) {
			try {
				await new Promise<void>((resolve, reject) => {
					req.session.destroy(err => err ? reject(err) : resolve());
				});
			} catch {
				res.setHeader("Cache-Control", "private, no-store");
				res.status(503).json({code: "SESSION_VALIDATION_UNAVAILABLE"});
				return;
			}

			logger.info("Session expired due to inactivity.");
			sessionUnauthorizedResponse(req, res, "Session expired due to inactivity.", "SESSION_EXPIRED");
			return;
		}

		// Probes and CSRF bootstrap are not evidence of use. Activity is validated by its controller.
		const passiveProbe = req.path === "/api/me" && req.query?.passive === "1";
		// Unmarked /api/me remains compatible with the old production frontend during rollout.
		const readingRequest = req.path === "/api/reading" || req.path.startsWith("/api/reading/");
		if (!passiveProbe && !readingRequest && !["/api/csrf-token", "/api/session/activity"].includes(req.path)) {
			(req.session as SessionData).lastActivity = now;
			// Save before streaming: completion of a long download must not overwrite newer playback activity.
			try {
				req.session.touch();
				await new Promise<void>((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
			} catch {
				res.setHeader("Cache-Control", "private, no-store");
				res.status(503).json({code: "SESSION_ACTIVITY_UNAVAILABLE"});
				return;
			}
		}
	}

	next();
}

import { Request, Response } from "express";
import { SessionData } from "(src)/models/interfaces/WebSocketTypes";

// Mounted after the session, single-session and CSRF middleware.
export async function sessionActivity(req: Request, res: Response): Promise<void> {
	res.setHeader("Cache-Control", "private, no-store");
	res.vary("Cookie");
	if (!req.session?.userId) {
		res.status(401).json({code: "UNAUTHENTICATED"});
		return;
	}
	if (!["audio", "interaction"].includes(req.body?.activity)) {
		res.status(400).json({code: "INVALID_ACTIVITY"});
		return;
	}
	try {
		(req.session as SessionData).lastActivity = Date.now();
		req.session.touch();
		await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
		res.sendStatus(204);
	} catch {
		res.status(503).json({code: "SESSION_ACTIVITY_UNAVAILABLE"});
	}
}

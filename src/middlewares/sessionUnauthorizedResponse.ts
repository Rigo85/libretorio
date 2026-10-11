import { Request, Response } from "express";
import path from "path";

export function sessionUnauthorizedResponse(req: Request, res: Response, error: string, code: string): void {
	res.clearCookie("connect.sid");
	res.setHeader("Cache-Control", "private, no-store");

	let pathname = "";
	try {
		pathname = path.posix.normalize(decodeURIComponent(req.path));
	} catch {
		// A malformed file URL must not become an HTML login response.
	}
	const isAppRoute = pathname === "/" || /^\/(auth|parent)(\/|$)/.test(pathname);
	if (req.method === "GET" && isAppRoute && req.accepts("html")) {
		res.redirect("/auth/login");
		return;
	}

	res.status(401).json({error, code});
}

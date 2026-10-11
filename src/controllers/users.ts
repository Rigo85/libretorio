import {Router, Request, Response} from "express";
import {rateLimit} from "express-rate-limit";
import {PostgresAdapter} from "(src)/db/PostgresAdapter";
import {UserManagement, UserManagementError} from "(src)/services/UserManagement";

export function usersRouter(admin = true): Router {
	const router = Router(), service = new UserManagement(PostgresAdapter.getInstance().pool);
	router.use((req, res, next) => {
		res.setHeader("Cache-Control", "private, no-store"); res.vary("Cookie");
		if (!req.session?.userId) {
			res.status(401).json({code: "UNAUTHENTICATED"}); return;
		}next();
	});
	router.use(rateLimit({windowMs: 60000, limit: 60, keyGenerator: req => req.session.userId, standardHeaders: true, legacyHeaders: false}));
	router.use(rateLimit({windowMs: 60000, limit: 10, skip: req => req.method === "GET", keyGenerator: req => req.session.userId, standardHeaders: true, legacyHeaders: false}));
	const identity = (req: Request) => ({userId: req.session.userId, sessionId: req.sessionID});
	const handle = (fn: (req: Request) => Promise<any>) => async (req: Request, res: Response) => {
		try {
			const result = await fn(req);
			if (result.selfRevoked) {
				await new Promise<void>((resolve, reject) => req.session.destroy(err => err ? reject(err) : resolve()));
				res.clearCookie("connect.sid");
			}
			res.json(result);
		} catch (error) {
			if (error instanceof UserManagementError) res.status(error.status).json({code: error.code});
			else {
				console.error("User management failed", {code: error.code ?? "INTERNAL"}); res.status(503).json({code: "USERS_UNAVAILABLE"});
			}
		}
	};
	if (admin) {
		router.get("/", handle(req => service.list(identity(req), req.query)));
		router.post("/", handle(req => service.create(identity(req), req.body)));
		router.patch("/:id", handle(req => service.update(identity(req), req.params.id, req.body, "edit")));
		router.post("/:id/password", handle(req => service.update(identity(req), req.params.id, req.body, "password")));
		router.post("/:id/revoke", handle(req => service.update(identity(req), req.params.id, req.body, "revoke")));
	} else router.post("/password", handle(req => service.changePassword(identity(req), req.body)));
	router.use((_req, res) => {
		res.status(404).json({code: "USER_ROUTE_NOT_FOUND"});
	});
	return router;
}

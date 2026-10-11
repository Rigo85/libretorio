import express, { Request, Response } from "express";
import compression from "compression";
import lusca from "lusca";
import helmet from "helmet";
import cors from "cors";
import path from "path";
import session from "express-session";
import csrf from "@dr.pogodin/csurf";
import rateLimit from "express-rate-limit";
import pgSession from "connect-pg-simple";
import { RedisStore } from "rate-limit-redis";
import requestIp from "request-ip";

import { PostgresAdapter } from "(src)/db/PostgresAdapter";
import { Logger } from "(src)/helpers/Logger";
import { config } from "(src)/config/configuration";
import { currentUser, login, logout } from "(src)/controllers/authetication";
import RedisAdapter from "(src)/db/RedisAdapter";
import { singleSessionMiddleware } from "(src)/middlewares/singleSessionMiddleware";
import { lastActivityMiddleware } from "(src)/middlewares/lastActivityMiddleware";
import { libraryFilesMiddleware } from "(src)/middlewares/libraryFilesMiddleware";
import { appStaticMiddleware } from "(src)/middlewares/appStaticMiddleware";
import { sessionActivity } from "(src)/controllers/sessionActivity";
import { readingRouter } from "(src)/controllers/reading";
import { usersRouter } from "(src)/controllers/users";

export async function bootstrap(): Promise<{ app: express.Express; sessionParser: any }> {
	const logger = new Logger("App");

	const pgStore = pgSession(session);
	const app = express();

	app.use((_, res, next) => {
		res.setHeader("X-Robots-Tag", "noindex, nofollow");
		next();
	});

	app.set("trust proxy", 1);   // un solo proxy: Cloudflare

	app.use(requestIp.mw());

	app.use(helmet({
		// contentSecurityPolicy: {
		// 	useDefaults: true,                          // mantiene las demás defensas
		// 	directives: {
		// 		// eslint-disable-next-line @typescript-eslint/naming-convention
		// 		"script-src-attr": ["'unsafe-inline'"]   // permite onclick=...
		// 	}
		// }
		contentSecurityPolicy: false   // ← deshabilita CSP por completo
		// contentSecurityPolicy: {
		// 	reportOnly: true   // CSP-Report-Only header
		// }
	}));
	app.use(compression());

	app.use(express.json());
	app.use(express.urlencoded({extended: true}));

	const sessionParser = session({
		store: new pgStore({pool: PostgresAdapter.getInstance().pool, disableTouch: true}),
		secret: config.production.server.sessionSecret,
		resave: false,
		saveUninitialized: false,
		cookie: {
			httpOnly: true,
			secure: true,
			// secure: config.production.server.environment === "production",
			sameSite: "lax",
			maxAge: 1 * 60 * 60 * 1000       // 1 horas
		},
		rolling: false                      // Solo actividad aceptada modifica y renueva la sesion.
	});

	app.use(sessionParser);
	app.use(singleSessionMiddleware);
	app.use(csrf());
	app.use(lastActivityMiddleware);

	const client = await RedisAdapter.initialize();

	if (!client) {
		logger.error("Redis client initialization failed.");
		return;
	}

	const limiter = rateLimit({
		windowMs: 15 * 60 * 1000,
		limit: 300,
		standardHeaders: true,
		legacyHeaders: false,
		store: new RedisStore({
			sendCommand: (...args: string[]) => client.sendCommand(args),
			prefix: "rate-limit:"
		}),
		skip: (req) =>
			(process.env.READING_ENABLED === "1" && !!req.session?.userId && req.path.startsWith("/api/reading/")) ||
			["GET", "HEAD"].includes(req.method) ||
			/^\/(covers|assets)\//.test(req.path)
	});

	app.use(limiter);

	app.use(cors({
		origin: process.env.ALLOWED_ORIGIN || "https://libretorio.rji-services.org",
		credentials: true
	}));
	app.use(lusca.xframe("SAMEORIGIN"));
	app.use(lusca.xssProtection(true));

	app.set("port", config.production.server.port);
	app.use(libraryFilesMiddleware(
		path.join(__dirname, "public"),
		`${path.dirname(__dirname)}-Scanner/dist/public/books`
	));
	app.use(appStaticMiddleware(path.join(__dirname, "public")));

	app.use("/covers", express.static(path.join(__dirname, "public/covers"), {fallthrough: false}));
	app.use("/temp_covers", express.static(path.join(__dirname, "public/temp_covers"), {fallthrough: false}));

	app.get("/api/csrf-token", async (req: Request, res: Response) => {
		res.setHeader("Cache-Control", "private, no-store");
		res.vary("Cookie");
		res.json({csrfToken: req.csrfToken()});
	});

	const loginLimiter = rateLimit({
		windowMs: 15 * 60 * 1000,
		limit: 10,
		standardHeaders: true,
		legacyHeaders: false,
		store: new RedisStore({
			sendCommand: (...args: string[]) => client.sendCommand(args),
			prefix: "rate-limit:login:"
		})
	});

	app.post("/api/login", loginLimiter, login);
	app.post("/api/logout", logout);
	app.get("/api/me", currentUser);
	app.post("/api/session/activity", sessionActivity);
	if (process.env.ADMIN_USERS_ENABLED === "1") {
		app.use("/api/admin/users", usersRouter());
		app.use("/api/account", usersRouter(false));
	} else app.use(["/api/admin/users", "/api/account"], (_req, res) => {
		res.status(404).json({code: "USER_MANAGEMENT_DISABLED"});
	});
	if (process.env.READING_ENABLED === "1") app.use("/api/reading", readingRouter());
	else app.use("/api/reading", (_req, res) => {
		res.status(404).json({code: "READING_DISABLED"});
	});

	app.get("/*", (_req, res) => {
		res.setHeader("Cache-Control", "no-cache");
		res.sendFile(path.join(__dirname, "public", "index.html"));
	});

	return {app, sessionParser};
}

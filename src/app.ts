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

	app.use(helmet());
	app.use(compression());

	app.use(express.json());
	app.use(express.urlencoded({extended: true}));

	const sessionParser = session({
		store: new pgStore({pool: PostgresAdapter.getInstance().pool}),
		secret: config.production.server.sessionSecret,
		resave: false,
		saveUninitialized: false,
		cookie: {
			httpOnly: true,
			secure: true, // sólo HTTPS TODO: habilitar en producción
			// secure: config.production.server.environment === "production",
			sameSite: "lax",
			maxAge: 2 * 60 * 60 * 1000       // 2 horas
		},
		rolling: true                       // renueva maxAge en cada respuesta
	});
	app.use(sessionParser);
	app.use(csrf());

	const client = await RedisAdapter.initialize();

	if (!client) {
		logger.error("Redis client initialization failed.");
		return;
	}

	const limiter = rateLimit({
		windowMs: 15 * 60 * 1000,
		limit: 100,
		standardHeaders: true,
		legacyHeaders: false,
		store: new RedisStore({
			sendCommand: (...args: string[]) => client.sendCommand(args),
			prefix: "rate-limit:"
		}),
		skip: (req) =>
			["GET", "HEAD"].includes(req.method) ||
			/^\/(covers|assets)\//.test(req.path)
	});

	app.use(limiter);

	app.use(cors());
	app.use(lusca.xframe("SAMEORIGIN"));
	app.use(lusca.xssProtection(true));

	app.set("port", config.production.server.port);
	app.use(express.static(path.join(__dirname, "public"), {maxAge: 31557600000}));

	app.use("/covers", express.static(path.join(__dirname, "public/covers")));
	app.use("/temp_covers", express.static(path.join(__dirname, "public/temp_covers")));

	app.get("/api/csrf-token", async (req: Request, res: Response) => {
		res.json({csrfToken: req.csrfToken()});
	});

	app.post("/api/login", login);
	app.post("/api/logout", logout);
	app.get("/api/me", currentUser);

	app.get("/*", (_req, res) =>
		res.sendFile(path.join(__dirname, "public", "index.html"))
	);

	return {app, sessionParser};
}

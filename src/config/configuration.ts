// src/config/configuration.ts
import path from "path";
import * as dotenv from "dotenv";

dotenv.config({path: ".env"});

export const config = {
	production: {
		db: {
			databaseUrl: process.env.DATABASE_URL,
			redisUrl: process.env.REDIS_URL
		},
		server: {
			port: parseInt(process.env.PORT || "3005"),
			environment: process.env.NODE_ENV || "development",
			sessionSecret: process.env.SESSION_SECRET!
		},
		paths: {
			public: path.join(__dirname, "..", "public"),
			covers: path.join(__dirname, "..", "public", "covers"),
			tempCovers: path.join(__dirname, "..", "public", "temp_covers"),
			cache: path.join(__dirname, "..", "public", "cache")
		},
		websocket: {
			pingInterval: parseInt(process.env.WS_PING_INTERVAL || "30000"),
			upgradeTimeout: parseInt(process.env.WS_UPGRADE_TIMEOUT || "10000"),
			shutdownTimeout: parseInt(process.env.WS_SHUTDOWN_TIMEOUT || "5000")
		}
	},
	development: {}
};

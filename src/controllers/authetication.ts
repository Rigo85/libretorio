import { Request, Response } from "express";
import { UserRepository } from "(src)/repositories/UserRepository";
import { UserLoginRepository } from "(src)/repositories/UserLoginRepository";
import { verify } from "@node-rs/argon2";
import { Logger } from "(src)/helpers/Logger";
import { SessionData } from "(src)/models/interfaces/WebSocketTypes";
// import { getIpAddress } from "(src)/utils/ipUtils";

const logger = new Logger("Authentication");

declare module "express-session" {
	interface SessionData {
		userId: string;
		isAdmin: boolean;
	}
}

export async function login(req: Request, res: Response): Promise<void> {
	try {
		const {email, password} = req.body;
		logger.info(JSON.stringify({email}));

		if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password.trim()) {
			res.status(400).json({error: "Email and password are required."});
			return;
		}

		const genericErrorMsg = "Invalid credentials.";

		const user = await UserRepository.getInstance().findByEmail(email);
		if (!user) {
			logger.info(`Login attempt with non-existing user: ${email}`);
			res.status(401).json({error: genericErrorMsg});
			return;
		}

		if (!user.isActive) {
			logger.info(`Login attempt with non-active user: ${email}`);
			res.status(401).json({error: genericErrorMsg});
			return;
		}

		const passwordValid = await verify(user.passwordHash, password);
		if (!passwordValid) {
			logger.info(`Login attempt with invalid password for user: ${email}`);
			res.status(401).json({error: genericErrorMsg});
			return;
		}

		await new Promise<void>((resolve, reject) => {
			req.session.regenerate(err => err ? reject(err) : resolve());
		});
		if (!await UserRepository.getInstance().updateSessionId(user.id, req.sessionID, user.passwordHash)) {
			res.status(503).json({error: "Unable to establish session."});
			return;
		}

		req.session.userId = user.id;
		req.session.isAdmin = user.isAdmin;
		(req.session as SessionData).lastActivity = Date.now();
		await new Promise<void>((resolve, reject) => {
			req.session.save(err => err ? reject(err) : resolve());
		});

		try {
			// await UserLoginRepository.getInstance().insert(user.id, getIpAddress(req), req.get("User-Agent") || "unknown");
			await UserLoginRepository.getInstance().insert(user.id, req.clientIp, req.get("User-Agent") || "unknown");
		} catch (error) {
			logger.error(`Error registrando login: ${error}`);
		}

		logger.info(`User ${user.id} (${email}) logged in successfully.`);
		res.sendStatus(200);
	} catch (error) {
		logger.error(`Error during login: ${error}`);
		res.status(500).json({error: "An error occurred during login."});
	}
}

export async function logout(req: Request, res: Response): Promise<void> {
	if (!req.session.userId) {
		res.status(200).json({success: true});
		return;
	}

	const userId = req.session.userId;

	try {
		// A late save from an in-flight request must not resurrect this logged-out session.
		await UserRepository.getInstance().invalidateSession(userId, req.sessionID);
		await new Promise<void>((resolve, reject) => {
			req.session.destroy((err) => {
				if (err) reject(err);
				else resolve();
			});
		});

		res.clearCookie("connect.sid");
		logger.info(`User ${userId} logged out successfully.`);

		res.status(200).json({success: true});
	} catch (error) {
		logger.error(`Error during logout for user ${userId}: ${error}`);
		res.status(500).json({error: "An error occurred during logout."});
	}
}

export async function currentUser(req: Request, res: Response): Promise<void> {
	res.setHeader("Cache-Control", "private, no-store");
	res.vary("Cookie");
	if (!req.session?.userId) {
		res.status(401).json({authenticated: false});
		return;
	}

	try {
		const userId = req.session.userId;
		const current = await UserRepository.getInstance().currentIdentity(userId, req.sessionID);
		if (!current) {
			res.status(401).json({authenticated: false}); return;
		}
		res.json({authenticated: true, userId, isAdmin: current.isAdmin, userManagementEnabled: process.env.ADMIN_USERS_ENABLED === "1"});
	} catch {
		res.status(503).json({code: "SESSION_VALIDATION_UNAVAILABLE"});
	}
}

import { Request, Response } from "express";
import { UserRepository } from "(src)/repositories/UserRepository";
import { UserLoginRepository } from "(src)/repositories/UserLoginRepository";
import { verify } from "@node-rs/argon2";
import { Logger } from "(src)/helpers/Logger";
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
		logger.info(JSON.stringify(req.body));

		if (!email?.trim() || !password?.trim() || typeof email !== "string" || typeof password !== "string") {
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
			res.status(401).json({error: "User is not active."});
			return;
		}

		const passwordValid = await verify(user.passwordHash, password);
		if (!passwordValid) {
			logger.info(`Login attempt with invalid password for user: ${email}`);
			res.status(401).json({error: genericErrorMsg});
			return;
		}

		await UserRepository.getInstance().updateSessionId(user.id, req.sessionID);

		req.session.userId = user.id;
		req.session.isAdmin = user.isAdmin;

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
		await new Promise<void>((resolve, reject) => {
			req.session.destroy((err) => {
				if (err) reject(err);
				else resolve();
			});
		});

		res.clearCookie(req.sessionID ? "connect.sid" : "session");
		logger.info(`User ${userId} logged out successfully.`);

		res.status(200).json({success: true});
	} catch (error) {
		logger.error(`Error during logout for user ${userId}: ${error}`);
		res.status(500).json({error: "An error occurred during logout."});
	}
}

export async function currentUser(req: Request, res: Response): Promise<void> {
	if (!req.session?.userId) {
		res.status(401).json({authenticated: false});
		return;
	}

	const {userId, isAdmin} = req.session!;
	res.json({
		authenticated: true,
		userId,
		isAdmin
	});
}

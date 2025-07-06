import { User } from "(src)/models/interfaces/User";
import { PostgresAdapter } from "(src)/db/PostgresAdapter";
import { Logger } from "(src)/helpers/Logger";

const logger = new Logger("UserRepository");

export class UserRepository {
	private static instance: UserRepository;

	private constructor() {
	}

	public static getInstance(): UserRepository {
		if (!UserRepository.instance) {
			UserRepository.instance = new UserRepository();
		}
		return UserRepository.instance;
	}

	public async findByEmail(email: string): Promise<User | undefined> {
		try {
			const query = "SELECT * FROM users WHERE email = $1";
			const rows = await PostgresAdapter.getInstance().query(query, [email]);

			if (rows?.length) {
				return {
					id: rows[0].id,
					email: rows[0].email,
					passwordHash: rows[0].password_hash,
					isAdmin: rows[0].is_admin,
					preferences: rows[0].prefs,
					isActive: rows[0].is_active,
					createdAt: rows[0].created_at
				};
			}

			return undefined;
		} catch (error) {
			logger.error("findByEmail", error.message);

			return undefined;
		}
	}

	public async updateSessionId(userId: string, sessionId: string): Promise<boolean> {
		try {
			const query = "UPDATE users SET session_id = $1 WHERE id = $2";
			await PostgresAdapter.getInstance().query(query, [sessionId, userId]);
			return true;
		} catch (error) {
			logger.error("updateSessionId", error.message);
			return false;
		}
	}

	public async getSessionId(userId: string): Promise<string | null> {
		try {
			const query = "SELECT session_id FROM users WHERE id = $1";
			const rows = await PostgresAdapter.getInstance().query(query, [userId]);

			return rows?.length ? rows[0].session_id : undefined;
		} catch (error) {
			logger.error("getSessionId", error.message);

			return undefined;
		}
	}

	/**
	 * Invalidates all sessions for a user by setting session_id to NULL.
	 * use cases:
	 * 1. User logs out from all devices.
	 * 2. Admin revokes all sessions for a user.
	 * 3. Changing password or security settings that require session invalidation.
	 *
	 * @param userId - The ID of the user whose sessions should be invalidated.
	 * @returns {Promise<boolean>} - Returns true if the operation was successful, false otherwise.
	 */
	public async invalidateAllSessions(userId: string): Promise<boolean> {
		try {
			const query = "UPDATE users SET session_id = NULL WHERE id = $1";
			await PostgresAdapter.getInstance().query(query, [userId]);

			return true;
		} catch (error) {
			logger.error("invalidateAllSessions", error.message);

			return false;
		}
	}
}
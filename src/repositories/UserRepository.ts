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
			const query = "SELECT * FROM users WHERE lower(btrim(email)) = lower(btrim($1))";
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

	public async updateSessionId(userId: string, sessionId: string, verifiedPasswordHash: string): Promise<boolean> {
		const result = await PostgresAdapter.getInstance().pool.query(
			"UPDATE users SET session_id = $1 WHERE id = $2 AND is_active = true AND password_hash=$3 RETURNING id",
			[sessionId, userId, verifiedPasswordHash]
		);
		return result.rowCount === 1;
	}

	public async getSessionId(userId: string): Promise<string | undefined> {
		// Authentication queries must propagate DB failures, unlike catalogue lookups.
		const {rows} = await PostgresAdapter.getInstance().pool.query(
			"SELECT session_id FROM users WHERE id = $1 AND is_active = true", [userId]
		);
		return rows[0]?.session_id ?? undefined;
	}

	public async currentIdentity(userId: string, sessionId: string): Promise<{isAdmin: boolean} | undefined> {
		const {rows} = await PostgresAdapter.getInstance().pool.query(
			'SELECT is_admin AS "isAdmin" FROM users WHERE id=$1 AND session_id=$2 AND is_active=true', [userId, sessionId]
		);
		return rows[0];
	}

	public async invalidateSession(userId: string, sessionId: string): Promise<void> {
		await PostgresAdapter.getInstance().pool.query(
			"UPDATE users SET session_id = NULL WHERE id = $1 AND session_id = $2", [userId, sessionId]
		);
	}

	public async getWebSocketSession(userId: string, sessionId: string): Promise<{isAdmin: boolean; lastActivity?: number} | undefined> {
		const {rows} = await PostgresAdapter.getInstance().pool.query(
			`SELECT u.is_admin AS "isAdmin", s.sess->>'lastActivity' AS "lastActivity"
			 FROM users u JOIN session s ON s.sid = u.session_id
			 WHERE u.id = $1 AND u.session_id = $2 AND u.is_active = true
			 AND s.expire > NOW() AND s.sess->>'userId' = u.id::text`,
			[userId, sessionId]
		);
		if (!rows[0]) return undefined;
		const lastActivity = Number(rows[0].lastActivity);
		return {isAdmin: rows[0].isAdmin, lastActivity: Number.isFinite(lastActivity) && lastActivity > 0 ? lastActivity : undefined};
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

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
					createdAt: rows[0].created_at
				};
			}

			return undefined;
		} catch (error) {
			logger.error("findByEmail", error.message);

			return undefined;
		}
	}
}
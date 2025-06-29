import { PostgresAdapter } from "(src)/db/PostgresAdapter";
import { Logger } from "(src)/helpers/Logger";

const logger = new Logger("UserLoginRepository");

export class UserLoginRepository {
	private static instance: UserLoginRepository;

	private constructor() {}

	public static getInstance(): UserLoginRepository {
		if (!UserLoginRepository.instance) {
			UserLoginRepository.instance = new UserLoginRepository();
		}
		return UserLoginRepository.instance;
	}

	public async insert(userId: string, ip: string, userAgent: string): Promise<void> {
		logger.info(`insert: userId="${userId}", ip="${ip}"`);

		try {
			const query = `
                INSERT INTO user_logins (user_id, ip, user_agent)
                VALUES ($1, $2, $3)
			`;
			const values = [userId, ip, userAgent];
			await PostgresAdapter.getInstance().query(query, values);
		} catch (error) {
			logger.error("insert", error.message);
		}
	}
}

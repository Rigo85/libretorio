import { Logger } from "(src)/helpers/Logger";
import { PostgresAdapter } from "(src)/db/PostgresAdapter";
import { File } from "(src)/models/interfaces/File";

const logger = new Logger("FileRepository");

export class FileRepository {
	private static instance: FileRepository;

	private constructor() {
	}

	public static getInstance(): FileRepository {
		if (!FileRepository.instance) {
			FileRepository.instance = new FileRepository();
		}
		return FileRepository.instance;
	}

	public async update(file: File): Promise<boolean> {
		logger.info(`update: "${file.name}"`);

		try {
			const query = `
                UPDATE archive
                SET "webDetails"    = $1,
                    "customDetails" = $2
                WHERE id = $3 RETURNING id
			`;
			const values = [file.webDetails, file.customDetails ?? false, file.id];
			const rows = await PostgresAdapter.getInstance().query(query, values);

			if (!rows?.length) {
				logger.error(`Error updating file: "${file.name}".`);

				return false;
			}

			return true;
		} catch (error) {
			logger.error(`update "${file.name}":`, error.message);

			return false;
		}
	}

	public async findAllByHash(parentHash: string, offset: number, limit: number): Promise<File[]> {
		try {
			const query = `
                SELECT *
                FROM archive a
                WHERE a."parentHash" = $1
                ORDER BY a.id ASC
                OFFSET $2 LIMIT $3
			`;
			const values = [parentHash, offset, limit];
			const rows = await PostgresAdapter.getInstance().query(query, values);

			return rows || [];
		} catch (error) {
			logger.error("findAllByHash", error.message);

			return [];
		}
	}

	public async countByHash(parentHash: string): Promise<number> {
		try {
			const query = `
                SELECT COUNT(*) AS count
                FROM archive a
                WHERE a."parentHash" = $1
			`;
			const values = [parentHash];
			const rows = await PostgresAdapter.getInstance().query(query, values);

			return rows?.length ? rows[0].count : 0;
		} catch (error) {
			logger.error("countByHash", error.message);

			return 0;
		}
	}

	public async findAllByText(searchText: string, offset: number, limit: number): Promise<File[]> {
		try {
			const query = `
                SELECT *
                FROM archive
                WHERE name ILIKE '%' || $1 || '%'
                   OR ("localDetails" IS NOT NULL
                  AND "localDetails"::text ILIKE '%' || $1 || '%')
                   OR ("webDetails" IS NOT NULL
                  AND "webDetails"::text ILIKE '%' || $1 || '%')
                OFFSET $2 LIMIT $3;
			`;
			const values = [searchText, offset, limit];
			const rows = await PostgresAdapter.getInstance().query(query, values);

			return rows || [];
		} catch (error) {
			logger.error("findAllByText", error.message);

			return [];
		}
	}

	public async countByText(searchText: string): Promise<number> {
		try {
			const query = `
                SELECT COUNT(*) AS count
                FROM archive
                WHERE
                    name ILIKE '%' || $1 || '%'
                   OR ("localDetails" IS NOT NULL
                  AND "localDetails"::text ILIKE '%' || $1 || '%')
                   OR ("webDetails" IS NOT NULL
                  AND "webDetails"::text ILIKE '%' || $1 || '%')
			`;
			const values = [searchText];
			const rows = await PostgresAdapter.getInstance().query(query, values);

			return rows?.length ? rows[0].count : 0;
		} catch (error) {
			logger.error("countByText", error.message);

			return 0;
		}
	}
}
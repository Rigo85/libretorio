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

	public async findAllByHashWithCount(parentHash: string, offset: number, limit: number): Promise<{ files: File[]; total: number }> {
		try {
			const query = `
                SELECT
                    a.*,
                    CASE
                        WHEN a."fileKind" = 'COMIC-MANGA' THEN cas.reader_ready
                        WHEN a."fileKind" = 'FILE' AND lower(a.name) ~ '\\.(cbr|cbz|cb7|cbt)$' THEN cas.reader_ready
                        ELSE NULL
                    END AS "comicReaderReady",
                    COUNT(*) OVER() AS total_count
                FROM archive a
                LEFT JOIN cache_artifact_state cas ON cas.cover_id = a."coverId"
                WHERE a."parentHash" = $1
                ORDER BY a.id ASC
                OFFSET $2 LIMIT $3
			`;
			const values = [parentHash, offset, limit];
			const rows = await PostgresAdapter.getInstance().query(query, values);

			if (!rows?.length) return {files: [], total: 0};

			const total = parseInt(rows[0].total_count, 10);
			// eslint-disable-next-line @typescript-eslint/naming-convention
			const files = rows.map(({total_count, ...file}: any) => FileRepository.mapRowToFile(file));

			return {files, total};
		} catch (error) {
			logger.error("findAllByHashWithCount", error.message);

			return {files: [], total: 0};
		}
	}

	public async findAllByTextWithCount(searchText: string, offset: number, limit: number): Promise<{ files: File[]; total: number }> {
		try {
			const query = `
                SELECT
                    a.*,
                    CASE
                        WHEN a."fileKind" = 'COMIC-MANGA' THEN cas.reader_ready
                        WHEN a."fileKind" = 'FILE' AND lower(a.name) ~ '\\.(cbr|cbz|cb7|cbt)$' THEN cas.reader_ready
                        ELSE NULL
                    END AS "comicReaderReady",
                    COUNT(*) OVER() AS total_count
                FROM archive a
                LEFT JOIN cache_artifact_state cas ON cas.cover_id = a."coverId"
                WHERE a.name ILIKE '%' || $1 || '%'
                   OR (a."localDetails" IS NOT NULL
                  AND a."localDetails"::text ILIKE '%' || $1 || '%')
                   OR (a."webDetails" IS NOT NULL
                  AND a."webDetails"::text ILIKE '%' || $1 || '%')
                OFFSET $2 LIMIT $3
			`;
			const values = [searchText, offset, limit];
			const rows = await PostgresAdapter.getInstance().query(query, values);

			if (!rows?.length) return {files: [], total: 0};

			const total = parseInt(rows[0].total_count, 10);
			// eslint-disable-next-line @typescript-eslint/naming-convention
			const files = rows.map(({total_count, ...file}: any) => FileRepository.mapRowToFile(file));

			return {files, total};
		} catch (error) {
			logger.error("findAllByTextWithCount", error.message);

			return {files: [], total: 0};
		}
	}

	private static mapRowToFile(row: any): File {
		const file = row as File;

		if (typeof file.comicReaderReady !== "boolean") {
			delete file.comicReaderReady;
		}

		return file;
	}
}

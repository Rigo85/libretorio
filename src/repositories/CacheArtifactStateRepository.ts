import { Logger } from "(src)/helpers/Logger";
import { PostgresAdapter } from "(src)/db/PostgresAdapter";

const logger = new Logger("CacheArtifactStateRepository");

export class CacheArtifactStateRepository {
	private static instance: CacheArtifactStateRepository;

	private constructor() {
	}

	public static getInstance(): CacheArtifactStateRepository {
		if (!CacheArtifactStateRepository.instance) {
			CacheArtifactStateRepository.instance = new CacheArtifactStateRepository();
		}
		return CacheArtifactStateRepository.instance;
	}

	public async isReaderReady(coverId: string): Promise<boolean> {
		try {
			const query = `
                SELECT reader_ready
                FROM cache_artifact_state
                WHERE cover_id = $1
                LIMIT 1
			`;
			const rows = await PostgresAdapter.getInstance().query(query, [coverId]);

			return rows?.[0]?.reader_ready === true;
		} catch (error) {
			logger.error("isReaderReady", error.message);

			return false;
		}
	}
}

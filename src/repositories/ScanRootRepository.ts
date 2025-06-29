import { Logger } from "(src)/helpers/Logger";
import { ScanRoot } from "(src)/models/interfaces/ScanRoot";
import { PostgresAdapter } from "(src)/db/PostgresAdapter";

const logger = new Logger("ScanRootRepository");

export class ScanRootRepository {
	private static instance: ScanRootRepository;

	private constructor() {

	}

	public static getInstance(): ScanRootRepository {
		if (!ScanRootRepository.instance) {
			ScanRootRepository.instance = new ScanRootRepository();
		}
		return ScanRootRepository.instance;
	}

	private async findAll(): Promise<ScanRoot[]> {
		logger.info("getScanRoots");

		try {
			const query = "SELECT * FROM scan_root";
			const rows = await PostgresAdapter.getInstance().query(query, []);

			return rows || [];
		} catch (error) {
			logger.error("findAll", error.message);

			return [];
		}
	}

	public async getScanRoots(): Promise<ScanRoot[]> {
		logger.info("getScanRoots");

		try {
			return await this.findAll();
		} catch (error) {
			logger.error("getScanRoots", error.message);

			return [];
		}
	}
}

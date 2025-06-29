import { ScanRootRepository } from "(src)/repositories/ScanRootRepository";
import { Logger } from "(src)/helpers/Logger";
import { Directory } from "(src)/models/interfaces/Directory";
import { FileRepository } from "(src)/repositories/FileRepository";
import { ScanResult } from "(src)/models/interfaces/ScanResult";
import { File } from "(src)/models/interfaces/File";
import { getWebDetailsCoverId } from "(src)/utils/fileUtils";
import { checkIfPathExistsAndIsFile } from "(src)/utils/filesystemUtils";
import shell from "shelljs";
import path from "path";

const logger = new Logger("BooksService");

export class BooksService {
	private static instance: BooksService;

	private constructor() {
	}

	public static getInstance(): BooksService {
		if (!BooksService.instance) {
			BooksService.instance = new BooksService();
		}
		return BooksService.instance;
	}

	public async getBooksList(offset: number, limit: number, cleanUp: boolean, parentHash?: string): Promise<ScanResult> {
		logger.info("getBooksList:", {parentHash: parentHash ?? "root", offset, limit, cleanUp});

		try {
			const scanRoots = await ScanRootRepository.getInstance().getScanRoots();

			if (!scanRoots?.length) {
				logger.error("getBooksList", "No scan roots found");
				return undefined;
			}

			const directories = JSON.parse(scanRoots[0].directories) as Directory;
			const [files, total] = cleanUp ?
				[[], 0] :
				await Promise.all([
					FileRepository.getInstance().findAllByHash(parentHash ?? directories.hash, offset, limit),
					FileRepository.getInstance().countByHash(parentHash ?? directories.hash)]
				);

			return {directories, files, total};
		} catch (error) {
			logger.error("getBooksList", error);

			return undefined;
		}
	}

	public async updateBooksDetails(file: File): Promise<boolean> {
		logger.info("updateBooksDetails:", {id: file.id, name: file.name});

		try {
			const response = await FileRepository.getInstance().update(file);

			if (response) {
				// eslint-disable-next-line @typescript-eslint/naming-convention
				const cover_i = getWebDetailsCoverId(file);
				if (cover_i) {
					const coverPath = path.join(__dirname, "..", "public", "temp_covers", `${cover_i}.jpg`);
					if (checkIfPathExistsAndIsFile(coverPath)) {
						const cpResponse = shell.cp(coverPath, path.join(__dirname, "..", "public", "covers", `${cover_i}.jpg`));
						if (cpResponse.code === 0) {
							return true;
						} else {
							logger.error(`updateBooksDetails(code=${cpResponse.code})`, cpResponse.stderr ?? "Error copying cover image.");
						}
					} else {
						logger.error("updateBooksDetails", `Cover image not found: "${coverPath}".`);
					}
				} else {
					logger.error("updateBooksDetails", "Cover ID not found.");
				}
			}

			return response;
		} catch (error) {
			logger.error("updateBooksDetails", error);

			return false;
		}
	}

	public async searchBooksByTextOnDb(searchText: string, offset: number, limit: number): Promise<ScanResult> {
		logger.info("searchBooksByTextOnDb:", {searchText, offset, limit});

		try {
			const scanRoots = await ScanRootRepository.getInstance().getScanRoots();

			if (!scanRoots?.length) {
				logger.error("searchBooksByTextOnDb", "No scan roots found");
				return undefined;
			}

			const directories = JSON.parse(scanRoots[0].directories) as Directory;
			const [files, total] = await Promise.all([
				FileRepository.getInstance().findAllByText(searchText, offset, limit),
				FileRepository.getInstance().countByText(searchText)
			]);

			return {directories, files, total};
		} catch (error) {
			logger.error("searchBooksByTextOnDb", error);

			return undefined;
		}
	}
}
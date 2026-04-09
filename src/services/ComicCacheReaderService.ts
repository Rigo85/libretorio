import path from "path";
import fs from "fs-extra";

import { DecompressResponse } from "(src)/models/interfaces/DecompressTypes";
import { Logger } from "(src)/helpers/Logger";

const logger = new Logger("ComicCacheReaderService");

export class ComicCacheReaderService {
	private static instance: ComicCacheReaderService;

	private constructor() {
	}

	public static getInstance(): ComicCacheReaderService {
		if (!ComicCacheReaderService.instance) {
			ComicCacheReaderService.instance = new ComicCacheReaderService();
		}
		return ComicCacheReaderService.instance;
	}

	public async getInitialPages(id: string): Promise<DecompressResponse> {
		return this.readChunk(id, 0, "getInitialPages");
	}

	public async getMorePages(id: string, index: number): Promise<DecompressResponse> {
		return this.readChunk(id, index, "getMorePages");
	}

	private async readChunk(id: string, index: number, context: string): Promise<DecompressResponse> {
		try {
			if (!id) {
				logger.info("The Comic/Manga ID has not been provided.");
				return {error: "The Comic/Manga ID has not been provided.", success: "ERROR"};
			}

			if (index === undefined || index < 0) {
				logger.info("The Comic/Manga cache index has not been provided.");
				return {error: "The Comic/Manga cache index has not been provided.", success: "ERROR"};
			}

			const cachePath = path.join(__dirname, "..", "public", "cache", id);
			const cacheFilePath = path.join(cachePath, `${id}_${index}.cache`);

			if (!await fs.pathExists(cacheFilePath)) {
				logger.error(`The Comic/Manga cache file does not exist: "${cacheFilePath}"`);
				return {success: "ERROR", error: "Error getting comic/manga cache."};
			}

			const pages = await fs.readJson(cacheFilePath);
			return {pages, success: "OK"};
		} catch (error) {
			logger.error(context, error);

			return {success: "ERROR", error: error.message || "Error getting comic/manga cache."};
		}
	}
}

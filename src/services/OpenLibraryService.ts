import axios from "axios";
import path from "path";
import { Logger } from "(src)/helpers/Logger";
import { downloadImage } from "(src)/utils/imageUtils";
import { clearDirectory } from "(src)/utils/filesystemUtils";

const logger = new Logger("OpenLibrary");

export class OpenLibraryService {
	private static instance: OpenLibraryService;

	private constructor() {
	}

	public static getInstance(): OpenLibraryService {
		if (!OpenLibraryService.instance) {
			OpenLibraryService.instance = new OpenLibraryService();
		}
		return OpenLibraryService.instance;
	}

	public async searchBookInfoOpenLibrary(searchOptions: { title: string; author: string }): Promise<any[]> {
		logger.info("searchBookInfoOpenLibrary:", searchOptions);

		try {
			if (!searchOptions || [searchOptions.title, searchOptions.author].some(value => value !== undefined && (typeof value !== "string" || value.length > 500))) return [];
			const params = {limit: 10} as Record<string, any>;
			if (searchOptions.title?.trim()) {
				params.title = searchOptions.title;
			}
			if (searchOptions.author?.trim()) {
				params.author = searchOptions.author;
			}

			return this.search(params);
		} catch (error) {
			logger.error("searchBookInfoOpenLibrary", error);

			return [];
		}
	}

	private async search(params: Record<string, any>): Promise<any[]> {
		const url = "https://openlibrary.org/search.json";

		try {
			const response = await axios.get(url, {params, timeout: 15_000, maxContentLength: 2 * 1024 * 1024});

			if (Array.isArray(response.data.docs)) {
				await clearDirectory(path.join(__dirname, "..", "public", "temp_covers"));

				logger.info("searchBookInfoOpenLibrary", response.data.docs.length);

				for (const doc of response.data.docs.slice(0, 10)) {
					const coverId = doc.cover_i;
					const coverUrl = coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : "N/A";

					if (coverId && /^[1-9][0-9]*$/.test(String(coverId))) {
						const coverPath = path.join(__dirname, "..", "public", "temp_covers", `${coverId}.jpg`);
						await downloadImage(coverUrl, coverPath);
					}
				}

				logger.info("searchBookInfoOpenLibrary", "Done.");

				return response.data.docs;
			}
		} catch (error) {
			logger.error("searchBookInfoOpenLibrary", error);
		}

		return [];
	}
}

import path from "path";
import fs from "fs-extra";
import { extractFull } from "node-7z";
import sharp from "sharp";
import unzipper from "unzipper";
import { v4 as uuidv4 } from "uuid";
import { DecompressResponse } from "(src)/models/interfaces/DecompressTypes";
import { Logger } from "(src)/helpers/Logger";
import { findImagesInDirectory, savePagesToFile } from "(src)/utils/filesystemUtils";
import * as unrar from "node-unrar-js";

const logger = new Logger("DecompressService");

export class DecompressService {
	private static instance: DecompressService;

	private constructor() {
	}

	public static getInstance(): DecompressService {
		if (!DecompressService.instance) {
			DecompressService.instance = new DecompressService();
		}
		return DecompressService.instance;
	}

	public async decompressCB7(data: { filePath: string; id: string }): Promise<DecompressResponse> {
		logger.info(`decompressCB7: '${JSON.stringify(data)}'`);

		let extractPath = "";
		try {
			if (!data?.filePath) {
				logger.info("The path to the 7z file has not been provided.");
				return {error: "The path to the Comic/Manga file has not been provided.", success: "ERROR"};
			}

			if (!fs.existsSync(data.filePath)) {
				logger.info(`The 7z file does not exist: "${data.filePath}"`);
				return {error: `The Comic/Manga file does not exist: "${data.filePath}"`, success: "ERROR"};
			}

			const cachePath = path.join(__dirname, "..", "public", "cache", data.id);
			const cacheFilePath = path.join(cachePath, `${data.id}_0.cache`);

			if (fs.existsSync(cacheFilePath)) {
				const pages = JSON.parse(fs.readFileSync(cacheFilePath).toString());
				return {pages, success: "OK"};
			} else {
				extractPath = path.join(__dirname, `extracted-${uuidv4()}`);
				if (!fs.existsSync(extractPath)) {
					fs.mkdirSync(extractPath);
				}

				await new Promise<void>((resolve, reject) => {
					const extraction = extractFull(data.filePath, extractPath, {
						$bin: require("7zip-bin").path7za
					});

					extraction.on("end", () => {
						console.log("Extraction complete");
						resolve();
					});
					extraction.on("error", (err: any) => {
						console.error("Error during extraction:", err);
						reject(err);
					});
				});

				let images = await findImagesInDirectory(extractPath);

				images = images.sort((a, b) => a.path.localeCompare(b.path)).map(img => img.base64);

				fs.rmSync(extractPath, {recursive: true});

				await savePagesToFile(images, data.id);
				images.length = 0; // release base64 strings before re-reading from cache

				if (fs.existsSync(cacheFilePath)) {
					const pages = JSON.parse(fs.readFileSync(cacheFilePath).toString());
					return {pages, success: "OK"};
				} else {
					return {success: "ERROR", error: "Error extracting comic/manga book."};
				}
			}
		} catch (error) {
			logger.error("decompressCB7", error);

			return {success: "ERROR", error: error.message || "Error extracting comic/manga book."};
		} finally {
			if (extractPath && fs.existsSync(extractPath)) {
				fs.rmSync(extractPath, {recursive: true});
			}
		}
	}

	public async decompressRAR(data: { filePath: string; id: string }): Promise<DecompressResponse> {
		logger.info(`decompressRAR: '${JSON.stringify(data)}'`);

		let extractPath = "";
		try {
			if (!data?.filePath) {
				logger.info("The path to the RAR file has not been provided.");
				return {error: "The path to the Comic/Manga file has not been provided.", success: "ERROR"};
			}

			if (!fs.existsSync(data.filePath)) {
				logger.info(`The RAR file does not exist: "${data.filePath}"`);
				return {error: `The Comic/Manga file does not exist: "${data.filePath}"`, success: "ERROR"};
			}

			const cachePath = path.join(__dirname, "..", "public", "cache", data.id);
			const cacheFilePath = path.join(cachePath, `${data.id}_0.cache`);

			if (fs.existsSync(cacheFilePath)) {
				const pages = JSON.parse(fs.readFileSync(cacheFilePath).toString());
				return {pages, success: "OK"};
			} else {
				extractPath = path.join(__dirname, `extracted-${uuidv4()}`);
				if (!fs.existsSync(extractPath)) {
					fs.mkdirSync(extractPath);
				}

				let extracted = false;
				try {
					await new Promise<void>((resolve, reject) => {
						const extraction = extractFull(data.filePath, extractPath, {
							$bin: require("7zip-bin").path7za
						});
						extraction.on("end", () => resolve());
						extraction.on("error", (err: any) => reject(err));
					});
					extracted = true;
				} catch (e7z) {
					// 7za cannot open this archive (likely RAR5); fall back to node-unrar-js
					logger.info(`decompressRAR: 7za failed (${e7z.message?.trim()}), falling back to node-unrar-js`);
				}

				if (!extracted) {
					// node-unrar-js fallback (RAR5 / unsupported by 7za)
					const extractor = await unrar.createExtractorFromFile({
						filepath: data.filePath,
						targetPath: extractPath
					});
					const {files} = extractor.extract();
					// Must consume iterator fully to avoid memory leak (per node-unrar-js docs)
					for (const _file of files) { /* noop — extraction writes to targetPath */ }
				}

				let images = await findImagesInDirectory(extractPath);
				images = images.sort((a, b) => a.path.localeCompare(b.path)).map(img => img.base64);

				fs.rmSync(extractPath, {recursive: true});
				extractPath = "";

				await savePagesToFile(images, data.id);
				images.length = 0; // release base64 strings before re-reading from cache

				if (fs.existsSync(cacheFilePath)) {
					const pages = JSON.parse(fs.readFileSync(cacheFilePath).toString());
					return {pages, success: "OK"};
				} else {
					return {success: "ERROR", error: "Error extracting comic/manga book."};
				}
			}
		} catch (error) {
			logger.error("decompressRAR", error);

			return {success: "ERROR", error: error.message || "Error extracting comic/manga book."};
		} finally {
			if (extractPath && fs.existsSync(extractPath)) {
				fs.rmSync(extractPath, {recursive: true});
			}
		}
	}
	public async decompressZIP(data: { filePath: string; id: string }): Promise<DecompressResponse> {
		logger.info(`decompressZIP: '${JSON.stringify(data)}'`);

		let extractPath = "";
		try {
			if (!data?.filePath) {
				logger.info("The path to the ZIP file has not been provided.");
				return {error: "The path to the Comic/Manga file has not been provided.", success: "ERROR"};
			}

			if (!fs.existsSync(data.filePath)) {
				logger.info(`The ZIP file does not exist: "${data.filePath}"`);
				return {error: `The Comic/Manga file does not exist: "${data.filePath}"`, success: "ERROR"};
			}

			const cachePath = path.join(__dirname, "..", "public", "cache", data.id);
			const cacheFilePath = path.join(cachePath, `${data.id}_0.cache`);

			if (fs.existsSync(cacheFilePath)) {
				const pages = JSON.parse(fs.readFileSync(cacheFilePath).toString());
				return {pages, success: "OK"};
			} else {
				extractPath = path.join(__dirname, `extracted-${uuidv4()}`);
				if (!fs.existsSync(extractPath)) {
					fs.mkdirSync(extractPath);
				}

				await new Promise<void>((resolve, reject) => {
					fs.createReadStream(data.filePath)
						.pipe(unzipper.Extract({path: extractPath}))
						.on("close", resolve)
						.on("error", reject);
				});

				const files = fs.readdirSync(extractPath)
					.filter(file => /\.(jpg|jpeg|png|webp|gif)$/i.test(file))
					.sort((a, b) => a.localeCompare(b));

				const pages = [] as any[];
				for (const file of files) {
					const fileExtension = path.extname(file).toLowerCase();
					const filePath = path.join(extractPath, file);
					let imageBuffer: Buffer | null = await sharp(filePath).toBuffer();
					const base64Image = imageBuffer.toString("base64");
					imageBuffer = undefined;
					const base64 = `data:image/${fileExtension.slice(1)};base64,${base64Image}`;
					pages.push(base64);
				}

				fs.rmSync(extractPath, {recursive: true});

				await savePagesToFile(pages, data.id);
				pages.length = 0; // release base64 strings before re-reading from cache

				if (fs.existsSync(cacheFilePath)) {
					const pages = JSON.parse(fs.readFileSync(cacheFilePath).toString());
					return {pages, success: "OK"};
				} else {
					return {success: "ERROR", error: "Error extracting comic/manga book."};
				}
			}
		} catch (error) {
			logger.error("decompressZIP", error);

			return {success: "ERROR", error: error.message || "Error extracting comic/manga book."};
		} finally {
			if (extractPath && fs.existsSync(extractPath)) {
				fs.rmSync(extractPath, {recursive: true});
			}
		}
	}

	public async gettingComicMangaImages(data: { filePath: string; id: string }): Promise<DecompressResponse> {
		logger.info(`gettingComicMangaImages: '${JSON.stringify(data)}'`);

		try {
			if (!data?.filePath) {
				logger.info("The path to the Comic/Manga file has not been provided.");
				return {error: "The path to the Comic/Manga file has not been provided.", success: "ERROR"};
			}

			if (!fs.existsSync(data.filePath)) {
				logger.info(`The Comic/Manga file does not exist: "${data.filePath}"`);
				return {error: `The Comic/Manga file does not exist: "${data.filePath}"`, success: "ERROR"};
			}

			const cachePath = path.join(__dirname, "..", "public", "cache", data.id);
			const cacheFilePath = path.join(cachePath, `${data.id}_0.cache`);

			if (fs.existsSync(cacheFilePath)) {
				const pages = JSON.parse(fs.readFileSync(cacheFilePath).toString());
				return {pages, success: "OK"};
			} else {
				let images = await findImagesInDirectory(data.filePath);
				images = images.sort((a, b) => a.path.localeCompare(b.path)).map(img => img.base64);

				await savePagesToFile(images, data.id);
				images.length = 0; // release base64 strings before re-reading from cache

				if (fs.existsSync(cacheFilePath)) {
					const pages = JSON.parse(fs.readFileSync(cacheFilePath).toString());
					return {pages, success: "OK"};
				} else {
					return {success: "ERROR", error: "Error extracting comic/manga book."};
				}
			}
		} catch (error) {
			logger.error("gettingComicMangaImages", error);

			return {success: "ERROR", error: error.message || "Error getting comic/manga book."};
		}
	}

	public async getMorePages(id: string, index: number): Promise<DecompressResponse> {
		// logger.info(`getMorePages: '${id}', '${index}'`);

		try {
			if (!id) {
				logger.info("The Comic/Manga ID has not been provided.");
				return {error: "The Comic/Manga ID has not been provided.", success: "ERROR"};
			}

			if (index === undefined) {
				logger.info("The Comic/Manga cache index has not been provided.");
				return {error: "The Comic/Manga cache index has not been provided.", success: "ERROR"};
			}

			const cachePath = path.join(__dirname, "..", "public", "cache", id);
			const cacheFilePath = path.join(cachePath, `${id}_${index}.cache`);

			if (fs.existsSync(cacheFilePath)) {
				const pages = JSON.parse(fs.readFileSync(cacheFilePath).toString());
				return {pages, success: "OK"};
			} else {
				logger.error(`The Comic/Manga cache file does not exist: "${cacheFilePath}"`);
				return {success: "ERROR", error: "Error getting more pages."};
			}
		} catch (error) {
			logger.error("getMorePages", error);

			return {success: "ERROR", error: error.message || "Error getting more pages."};
		}
	}
}
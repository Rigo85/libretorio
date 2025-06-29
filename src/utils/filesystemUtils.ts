import fs from "fs-extra";
import { Logger } from "(src)/helpers/Logger";
import path from "path";
import sharp from "sharp";

const logger = new Logger("filesystemUtils");


export async function clearDirectory(path: string): Promise<boolean> {
	try {
		await fs.emptyDir(path);

		return true;
	} catch (error) {
		logger.error("clearDirectory", error);

		return false;
	}
}

export function checkIfPathExistsAndIsFile(filePath: string): boolean {
	if (fs.existsSync(filePath)) {
		return fs.statSync(filePath).isFile();
	}
	return false;
}

export async function findImagesInDirectory(dir: string): Promise<any[]> {
	let images: any[] = [];
	const files = fs.readdirSync(dir);

	for (const file of files) {
		const fullPath = path.join(dir, file);
		const stat = fs.statSync(fullPath);

		if (stat.isDirectory()) {
			images = images.concat(await findImagesInDirectory(fullPath));
		} else {
			const fileExtension = path.extname(file).toLowerCase();
			if ([".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(fileExtension)) {
				try {
					const imageBuffer = await sharp(fullPath).toBuffer();
					const base64Image = imageBuffer.toString("base64");
					images.push({
						path: fullPath,
						base64: `data:image/${fileExtension.slice(1)};base64,${base64Image}`
					});
				} catch (err) {
					logger.error("Error processing image:", err);
				}
			}
		}
	}
	return images;
}

export function savePagesToFile(pages: any[], id: string, sizeThreshold: number = 10 * 1024 * 1024): Promise<void> {
	try {
		const cachePath = path.join(__dirname, "..", "public", "cache", id);
		fs.mkdirSync(cachePath, {recursive: true});

		let currentSize = 0;
		let fileIndex = 0;
		let currentBatch: any[] = [];
		let pageIndex = 1;

		for (const page of pages) {
			const pageSize = Buffer.byteLength(JSON.stringify(page), "utf8");
			if (currentSize + pageSize > sizeThreshold && currentBatch.length) {
				// Save the current batch to a new file
				const cacheFilePath = path.join(cachePath, `${id}_${fileIndex}.cache`);
				fs.writeFileSync(
					cacheFilePath,
					JSON.stringify({
						pages: currentBatch,
						pageIndex,
						currentPagesLength: currentBatch.length,
						totalPages: pages.length,
						index: fileIndex
					})
				);
				pageIndex += currentBatch.length;
				fileIndex++;
				currentBatch = [];
				currentSize = 0;
			}
			currentBatch.push(page);
			currentSize += pageSize;
		}

		// Save the last batch if any
		if (currentBatch.length > 0) {
			const cacheFilePath = path.join(cachePath, `${id}_${fileIndex}.cache`);
			fs.writeFileSync(
				cacheFilePath,
				JSON.stringify({
					pages: currentBatch,
					pageIndex,
					currentPagesLength: currentBatch.length,
					totalPages: pages.length,
					index: fileIndex
				})
			);
		}

		return Promise.resolve();
	} catch (error) {
		logger.error("savePagesToFile", error);
	}
}

export function detectCompressionType(filePath: string): string {
	try {
		if (filePath?.trim()) {
			const buffer = Buffer.alloc(4); // Leemos los primeros 4 bytes
			const fd = fs.openSync(filePath, "r");
			fs.readSync(fd, buffer, 0, 4, 0);
			fs.closeSync(fd);

			// Magic numbers para 7z, RAR y ZIP
			const magicNumbers: { [key: string]: string } = {
				/* eslint-disable @typescript-eslint/naming-convention */
				"504B0304": "cbz",   // ZIP
				"52617221": "cbr",   // RAR (RAR3)
				"377ABCAF": "cb7"    // 7-Zip
				/* eslint-enable @typescript-eslint/naming-convention */
			};

			const fileSignature = buffer.toString("hex").toUpperCase();
			for (const [magic, type] of Object.entries(magicNumbers)) {
				if (fileSignature.startsWith(magic)) {
					return type;
				}
			}
		}

		return "";
	} catch (error) {
		logger.error("detectCompressionType", error);

		return "";
	}
}

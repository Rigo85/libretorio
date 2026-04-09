import fs from "fs-extra";
import { Logger } from "(src)/helpers/Logger";
import path from "path";
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


/** Collect image file paths recursively without loading image data into memory. */
export function findImagePathsInDirectory(dir: string): { filePath: string; ext: string }[] {
	const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
	let result: { filePath: string; ext: string }[] = [];
	for (const file of fs.readdirSync(dir)) {
		const fullPath = path.join(dir, file);
		if (fs.statSync(fullPath).isDirectory()) {
			result = result.concat(findImagePathsInDirectory(fullPath));
		} else {
			const ext = path.extname(file).toLowerCase();
			if (IMAGE_EXTS.has(ext)) {
				result.push({filePath: fullPath, ext});
			}
		}
	}
	return result;
}

/**
 * Stream images from disk to cache files one at a time.
 * Peak memory ≈ one batch (≤ sizeThreshold) + one image, regardless of archive size.
 */
export async function streamImagesToCache(
	imagePaths: { filePath: string; ext: string }[],
	id: string,
	sizeThreshold: number = 10 * 1024 * 1024
): Promise<void> {
	const cachePath = path.join(__dirname, "..", "public", "cache", id);
	fs.mkdirSync(cachePath, {recursive: true});

	const totalPages = imagePaths.length;
	let fileIndex = 0;
	let pageIndex = 1;
	let currentBatch: string[] = [];
	let currentSize = 0;

	const flushBatch = () => {
		if (currentBatch.length === 0) return;
		const cacheFilePath = path.join(cachePath, `${id}_${fileIndex}.cache`);
		fs.writeFileSync(
			cacheFilePath,
			JSON.stringify({pages: currentBatch, pageIndex, currentPagesLength: currentBatch.length, totalPages, index: fileIndex})
		);
		pageIndex += currentBatch.length;
		fileIndex++;
		currentBatch = [];
		currentSize = 0;
	};

	for (const {filePath, ext} of imagePaths) {
		try {
			// Read raw bytes — no libvips decode/re-encode; browsers handle jpg/png/webp/gif natively
			let buf: Buffer | undefined = await fs.promises.readFile(filePath);
			const base64 = `data:image/${ext.slice(1)};base64,${buf.toString("base64")}`;
			buf = undefined;

			const pageSize = Buffer.byteLength(base64, "utf8");
			if (currentSize + pageSize > sizeThreshold && currentBatch.length > 0) {
				flushBatch();
			}
			currentBatch.push(base64);
			currentSize += pageSize;
		} catch (err) {
			logger.error("streamImagesToCache: error processing image:", err);
		}
	}
	flushBatch();
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

export function isPathWithinRoot(filePath: string, root: string): boolean {
	const resolved = path.resolve(filePath);
	const resolvedRoot = path.resolve(root);
	return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
}

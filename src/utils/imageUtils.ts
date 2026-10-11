import { execFileSync } from "child_process";
import axios from "axios";
import fs from "fs-extra";
import { Logger } from "(src)/helpers/Logger";
import { Transform } from "stream";
import { pipeline } from "stream/promises";

const logger = new Logger("imageUtils");

/**
 * Converts a JPG file to WebP (quality 85) and removes the original.
 * If cwebp is not available or fails, the JPG is kept intact.
 */
export function convertToWebp(jpgPath: string): void {
	const webpPath = jpgPath.replace(/\.jpg$/i, ".webp");
	try {
		execFileSync("cwebp", ["-q", "85", jpgPath, "-o", webpPath], {stdio: "ignore", timeout: 30_000});
		fs.removeSync(jpgPath);
	} catch (error) {
		logger.error(`convertToWebp: could not convert "${jpgPath}" — ${error}`);
	}
}

export async function downloadImage(url: string, filepath: string): Promise<void> {
	if (!url?.trim() || !filepath?.trim()) {
		logger.error(`downloadImage: Missing parameters. url="${url}", filepath="${filepath}"`);
		return;
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 30_000);
	let received = 0;
	let startedWriting = false;
	try {
		const response = await axios({url, method: "GET", responseType: "stream", timeout: 15_000, signal: controller.signal});
		const limiter = new Transform({
			transform(chunk: Buffer, _encoding, callback) {
				received += chunk.length;
				callback(received > 10 * 1024 * 1024 ? new Error("Cover exceeds download limit") : undefined, chunk);
			}
		});
		startedWriting = true;
		await pipeline(response.data, limiter, fs.createWriteStream(filepath), {signal: controller.signal});
	} catch (error) {
		if (startedWriting) await fs.remove(filepath);
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}

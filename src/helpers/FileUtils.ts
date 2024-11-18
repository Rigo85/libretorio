import crypto from "crypto";
import fs from "fs";

// import { Logger } from "(src)/helpers/Logger";

// const logger = new Logger("File Utils");

export enum FileKind {
	/* eslint-disable @typescript-eslint/naming-convention */
	FILE = "FILE",
	COMIC_MANGA = "COMIC-MANGA",
	EPUB = "EPUB",
	NONE = "NONE"
	/* eslint-enable @typescript-eslint/naming-convention */
}


export interface File {
	id?: number;
	name: string;
	parentPath: string;
	parentHash: string;
	size: string;
	coverId: string;
	localDetails?: string;
	webDetails?: string;
	customDetails?: boolean;
	fileKind: FileKind;
}

export interface Directory {
	name: string;
	hash: string;
	directories: Directory[];
}

export interface DecompressResponse {
	success: "OK" | "ERROR";
	error?: string;
	pages?: DecompressPages;
}

export interface DecompressPages {
	pages: any[];
	pageIndex: number;
	currentPagesLength: number;
	totalPages: number;
	index: number;
}

export interface AudioBookMetadata {
	title: string;
	src: string;
	type: string;
	length: string;
}

export interface ScanResult {
	directories: Directory;
	files: File[];
	total?: number;
}

export interface ScanRootResult {
	root: string;
	scan: ScanResult;
}

export interface ConvertToPdfResponse {
	success: "OK" | "ERROR";
	error?: string;
	pdfPath?: string;
}

export type ConventToPdfUtilFunction = (filePath: string, coverId: string) => Promise<void>;

export function generateHash(data: string, full?: boolean): string {
	let hash: string;

	if (full) {
		hash = crypto.createHash("sha256").update(data).digest("hex");
	} else {
		hash = crypto.createHash("sha256").update(data).digest("hex").slice(0, 16);
	}

	return hash;
}

export function humanFileSize(bytes: number, si: boolean = false, dp: number = 1): string {
	const thresh = si ? 1000 : 1024;

	if (Math.abs(bytes) < thresh) {
		return bytes + " B";
	}

	const units = si
		? ["kB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]
		: ["KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB", "YiB"];
	let u = -1;
	const r = 10 ** dp;

	do {
		bytes /= thresh;
		++u;
	} while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1);

	return `${bytes.toFixed(dp)} ${units[u]}`;
}

export function checkIfPathExistsAndIsFile(filePath: string): boolean {
	if (fs.existsSync(filePath)) {
		return fs.statSync(filePath).isFile();
	}
	return false;
}

export function formatTime(seconds: number): string {
	if (isNaN(seconds) || !seconds) return "0:00";

	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.round(seconds % 60);

	const hours: string = h > 0 ? String(h).padStart(2, "0") + ":" : "";
	const minutes: string = (h > 0 || m > 0) ? String(m).padStart(2, "0") + ":" : "";
	const secs = String(s).padStart(2, "0");

	return hours + minutes + secs;
}
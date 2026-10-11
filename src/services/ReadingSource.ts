import path from "path";
import {realpath, stat, readFile} from "fs/promises";
import {createHash} from "crypto";
import {config} from "(src)/config/configuration";
import {PostgresAdapter} from "(src)/db/PostgresAdapter";

export type Representation = "pdf" | "converted-pdf" | "epub" | "audio" | "comic";
export class ReadingError extends Error {
	constructor(public status: number, public code: string) {
		super(code);
	}
}
export const fingerprint = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function representation(value: unknown): Representation {
	if (!["pdf", "converted-pdf", "epub", "audio", "comic"].includes(String(value))) throw new ReadingError(400, "INVALID_REPRESENTATION");
	return value as Representation;
}
export function relative(value: unknown): string {
	if (typeof value !== "string" || value.length > 4096 || !value || value.includes("\\") || value.includes("\0") ||
		value.startsWith("/") || value.split("/").some(part => !part || part === "." || part === "..")) throw new ReadingError(400, "INVALID_LOCATION");
	return value;
}
export function position(rep: Representation, input: any): any {
	if (!input || input.version !== 1) throw new ReadingError(400, "INVALID_POSITION");
	const bounded = (n: unknown, max: number): boolean => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= max;
	if (rep === "comic") {
		if (!Number.isSafeInteger(input.page) || !bounded(input.page, 999999) ||
			!Number.isSafeInteger(input.chunk) || !bounded(input.chunk, 9999)) throw new ReadingError(400, "INVALID_POSITION");
		return {version: 1, page: input.page, chunk: input.chunk};
	}
	if (rep === "audio") {
		if (!bounded(input.seconds, 31536000)) throw new ReadingError(400, "INVALID_POSITION");
		return {version: 1, track: relative(input.track), seconds: input.seconds};
	}
	if (rep === "epub") {
		if (typeof input.cfi !== "string" || input.cfi.length > 8192 || !/^epubcfi\(.+\)$/.test(input.cfi)) throw new ReadingError(400, "INVALID_POSITION");
		return {version: 1, cfi: input.cfi, section: relative(input.section), percent: bounded(input.percent, 100) ? input.percent : 0};
	}
	if (!Number.isSafeInteger(input.page) || !bounded(input.page, 1000000) || !bounded(input.ratio, 1)) throw new ReadingError(400, "INVALID_POSITION");
	if (input.layout !== undefined && (typeof input.layout !== "string" || input.layout.length > 200)) throw new ReadingError(400, "INVALID_POSITION");
	return {version: 1, page: input.page, ratio: input.ratio, mode: input.mode === "reading" ? "reading" : "original", ...(input.layout ? {layout: input.layout} : {})};
}

export class ReadingSource {
	async item(id: number): Promise<any> {
		const {rows} = await PostgresAdapter.getInstance().pool.query("SELECT * FROM archive WHERE id=$1", [id]);
		if (!rows[0]) throw new ReadingError(404, "MATERIAL_MISSING");
		return rows[0];
	}
	private async checked(target: string, root: string): Promise<{resolved: string; signature: string; directory: boolean}> {
		try {
			const boundary = await realpath(root), resolved = await realpath(target);
			if (resolved !== boundary && !resolved.startsWith(boundary + path.sep)) throw new ReadingError(403, "OUTSIDE_LIBRARY");
			const info = await stat(resolved, {bigint: true});
			if (!info.isFile() && !info.isDirectory()) throw new ReadingError(409, "SOURCE_UNAVAILABLE");
			return {resolved, directory: info.isDirectory(), signature: fingerprint([resolved, ...[info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].map(String)])};
		} catch (error) {
			if (error instanceof ReadingError) throw error;
			// ENOENT alone cannot distinguish an absent book from an unavailable mount.
			throw new ReadingError(409, "SOURCE_UNAVAILABLE");
		}
	}
	async resolve(item: any, rep?: Representation, locator?: any): Promise<{revision: string; path: string; comic?: {chunkCount: number; totalPages?: number}}> {
		const root = config.production.paths.booksRoot || path.join(config.production.paths.public, "books");
		const target = path.join(item.parentPath, item.name), original = await this.checked(target, root);
		let revision = original.signature;
		const relativePath = path.relative(await realpath(root), original.resolved).split(path.sep).map(encodeURIComponent).join("/");
		if (rep === "comic") {
			if ((original.directory ? item.fileKind !== "COMIC-MANGA" : !/\.(cbr|cbz|cb7|cbt)$/i.test(item.name)) ||
				! /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(item.coverId)) throw new ReadingError(400, "INVALID_REPRESENTATION");
			const {rows} = await PostgresAdapter.getInstance().pool.query("SELECT reader_ready,chunk_count FROM cache_artifact_state WHERE cover_id=$1", [item.coverId]);
			if (!rows[0]?.reader_ready) throw new ReadingError(409, "COMIC_CACHE_MISSING");
			const cache = config.production.paths.cache, directory = await this.checked(path.join(cache, item.coverId), cache);
			const statePath = path.join(directory.resolved, "_scanner_state.json");
			let chunkCount = rows[0].chunk_count, totalPages: number | undefined, stateSignature = "legacy";
			try {
				const info = await stat(statePath);
				if (info.size > 65536 || !info.isFile()) throw new ReadingError(409, "COMIC_CACHE_INVALID");
				const stateFile = await this.checked(statePath, directory.resolved);
				const state = JSON.parse(await readFile(stateFile.resolved, "utf8"));
				if (state.status !== "ready" || state.chunksReady !== true) throw new ReadingError(409, "COMIC_CACHE_MISSING");
				chunkCount = state.chunkCount; totalPages = state.totalPages; stateSignature = stateFile.signature;
				if (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > 1000000) throw new ReadingError(409, "COMIC_CACHE_INVALID");
			} catch (error) {
				if (error instanceof ReadingError) throw error;
				if (error.code !== "ENOENT") throw new ReadingError(409, "COMIC_CACHE_INVALID");
			}
			const chunk = locator?.chunk ?? 0;
			if (!Number.isSafeInteger(chunkCount) || chunkCount < 1 || chunkCount > 10000) throw new ReadingError(409, "COMIC_CACHE_INVALID");
			if (!Number.isSafeInteger(chunk) || chunk < 0 || chunk >= chunkCount ||
				(totalPages !== undefined && locator?.page !== undefined && locator.page >= totalPages)) throw new ReadingError(409, "COMIC_POSITION_MISSING");
			const first = await this.checked(path.join(directory.resolved, `${item.coverId}_0.cache`), directory.resolved);
			const selected = chunk === 0 ? first : await this.checked(path.join(directory.resolved, `${item.coverId}_${chunk}.cache`), directory.resolved);
			if (first.directory || selected.directory) throw new ReadingError(409, "COMIC_CACHE_INVALID");
			// Do not use snapshot.updated_at: legacy entries get a new date on every scan.
			return {revision: fingerprint([revision, directory.signature, stateSignature, first.signature]),
				path: `/books/${relativePath}`, comic: {chunkCount, totalPages}};
		}
		if (rep === "converted-pdf") {
			const {rows} = await PostgresAdapter.getInstance().pool.query("SELECT status,details FROM document_conversions WHERE archive_id=$1", [item.id]);
			if (rows[0]?.status !== "ready") throw new ReadingError(409, "PDF_NOT_READY");
			if (!/^[a-f0-9-]{36}$/i.test(item.coverId)) throw new ReadingError(409, "SOURCE_UNAVAILABLE");
			const pdf = path.join(config.production.paths.cache, item.coverId, `${item.coverId}.pdf`);
			const prepared = await this.checked(pdf, config.production.paths.cache), info = await stat(prepared.resolved, {bigint: true});
			if (prepared.directory || [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].map(String).join(":") !== rows[0].details?.outputSignature) throw new ReadingError(409, "PDF_NOT_READY");
			return {revision: fingerprint([revision, prepared.signature]), path: `/cache/${item.coverId}/${item.coverId}.pdf`};
		}
		if (rep === "pdf" && (original.directory || !/\.pdf$/i.test(item.name))) throw new ReadingError(400, "INVALID_REPRESENTATION");
		if (rep === "epub") {
			if (original.directory) {
				if (item.fileKind !== "EPUB") throw new ReadingError(400, "INVALID_REPRESENTATION");
				const opf = await this.checked(path.join(original.resolved, "OEBPS/content.opf"), root);
				revision = opf.signature;
				if (locator?.section) revision = fingerprint([revision, (await this.checked(path.join(original.resolved, "OEBPS", relative(locator.section)), root)).signature]);
			} else if (!/\.epub$/i.test(item.name)) throw new ReadingError(400, "INVALID_REPRESENTATION");
		}
		if (rep === "audio") {
			if (original.directory && item.fileKind !== "AUDIOBOOK") throw new ReadingError(400, "INVALID_REPRESENTATION");
			if (!original.directory && !/\.(mp3|m4a|m4b|wav|ogg|flac)$/i.test(item.name)) throw new ReadingError(400, "INVALID_REPRESENTATION");
			if (locator?.track) {
				const track = relative(locator.track);
				if (!/\.(mp3|m4a|m4b|wav|ogg|flac)$/i.test(track)) throw new ReadingError(400, "INVALID_LOCATION");
				if (!original.directory && track !== item.name) throw new ReadingError(400, "INVALID_LOCATION");
				revision = (await this.checked(original.directory ? path.join(original.resolved, track) : target, original.directory ? original.resolved : root)).signature;
			}
		}
		return {revision, path: `/books/${relativePath}`};
	}
}

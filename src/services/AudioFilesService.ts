import path from "path";
import fs from "fs-extra";

import { Logger } from "(src)/helpers/Logger";
import { AudioBookMetadata, AudioChapter } from "(src)/models/interfaces/AudioBookMetadata";
import { formatTime } from "(src)/utils/datetimeUtils";
import { PostgresAdapter } from "(src)/db/PostgresAdapter";
import { realpath, stat } from "fs/promises";

interface PreparedAudio {
	relativePath: string;
	signature: string;
	status: AudioBookMetadata["metadataStatus"];
	duration: number;
	chapters: AudioChapter[];
	details?: {format?: string; codec?: string};
}

const logger = new Logger("AudioFilesService");

export class AudioFilesService {
	private static instance: AudioFilesService;

	private constructor() {
	}

	public static getInstance(): AudioFilesService {
		if (!AudioFilesService.instance) {
			AudioFilesService.instance = new AudioFilesService();
		}
		return AudioFilesService.instance;
	}

	private readonly validExtensions = [".mp3", ".wav", ".m4a", ".m4b", ".ogg", ".flac"];

	public async getAudioFiles(filePath: string): Promise<AudioBookMetadata[]> {
		try {
			const dirents = await fs.readdir(filePath, {withFileTypes: true});
			const audioFiles = dirents
				.filter(dirent => dirent.isFile())
				.filter(dirent => this.validExtensions.includes(path.extname(dirent.name).toLowerCase()))
				.sort((a, b) => a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()))
			;

			const prepared = await this.loadPrepared(filePath);
			const audioMetadataPromises = audioFiles.map(async (dirent) => {
				const filePathResolved = path.resolve(filePath, dirent.name);
				return this.preparedTrack(filePathResolved, dirent.name, prepared.rows.get(dirent.name), prepared.available);
			});

			return (await Promise.all(audioMetadataPromises)).filter((track): track is AudioBookMetadata => !!track);
		} catch (error) {
			logger.error("getAudioFiles", error);
			return [];
		}
	}

	public async getAudioFile(filePath: string): Promise<AudioBookMetadata[]> {
		try {
			const fileName = path.basename(filePath);
			const extension = path.extname(fileName).toLowerCase();

			if (!this.validExtensions.includes(extension)) {
				logger.error(`getAudioFile: unsupported extension "${extension}" for "${filePath}"`);
				return [];
			}

			const filePathResolved = path.resolve(filePath);
			const prepared = await this.loadPrepared(filePathResolved);
			const track = await this.preparedTrack(filePathResolved, fileName, prepared.rows.get(""), prepared.available);
			return track ? [track] : [];
		} catch (error) {
			logger.error("getAudioFile", error);
			return [];
		}
	}

	private async loadPrepared(filePath: string): Promise<{available: boolean; rows: Map<string, PreparedAudio>}> {
		try {
			const {rows} = await PostgresAdapter.getInstance().pool.query<PreparedAudio>(`
                SELECT m.relative_path AS "relativePath",m.source_signature AS signature,m.status,
                    m.duration_seconds AS duration,m.chapters,m.details
                FROM audio_metadata m JOIN archive a ON a.id=m.archive_id
                WHERE a."parentPath"=$1 AND a.name=$2`, [path.dirname(filePath), path.basename(filePath)]);
			return {available: true, rows: new Map(rows.map(row => [row.relativePath, row]))};
		} catch (error) {
			logger.error("Prepared audio metadata unavailable", error.message);
			return {available: false, rows: new Map()};
		}
	}

	private async preparedTrack(source: string, name: string, metadata: PreparedAudio | undefined, available: boolean): Promise<AudioBookMetadata | undefined> {
		const track: AudioBookMetadata = {title: name, src: source, type: "",
			length: formatTime(0), metadataStatus: available ? "pending" : "unavailable"};
		try {
			const resolved = await realpath(source);
			const info = await stat(resolved, {bigint: true});
			if (!info.isFile()) return undefined;
			if (!metadata) return track;
			// This identity must match the scanner; no parsing, hashing or DB writes here.
			const signature = JSON.stringify([resolved, info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].map(String));
			if (signature !== metadata.signature) return {...track, metadataStatus: "stale"};
			if (metadata.status === "skipped") return undefined;
			track.metadataStatus = metadata.status;
			if (metadata.status === "ready" || metadata.status === "needs_review") {
				const duration = Number(metadata.duration);
				if (Number.isFinite(duration) && duration > 0) {
					track.durationSeconds = duration;
					track.length = formatTime(duration);
				}
				track.chapters = Array.isArray(metadata.chapters) ? metadata.chapters : [];
				track.type = this.preparedMime(metadata.details?.format);
			}
			return track;
		} catch (error) {
			logger.error("Audio track unavailable", {source, error: error.message});
			return undefined;
		}
	}

	private preparedMime(format = ""): string {
		const formats = format.split(",");
		// ffprobe's shared Matroska/WebM demuxer does not identify a specific MIME.
		if (formats.includes("matroska")) return "";
		if (formats.includes("webm")) return "audio/webm";
		if (formats.includes("mov") || formats.includes("mp4")) return "audio/mp4";
		if (formats.includes("mp3")) return "audio/mpeg";
		if (formats.includes("wav")) return "audio/wav";
		if (formats.includes("ogg")) return "audio/ogg";
		if (formats.includes("flac")) return "audio/flac";
		return "";
	}
}

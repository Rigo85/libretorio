import path from "path";
import fs from "fs-extra";
import * as mm from "music-metadata";
import { IAudioMetadata } from "music-metadata";

import { Logger } from "(src)/helpers/Logger";
import { AudioBookMetadata, AudioChapter } from "(src)/models/interfaces/AudioBookMetadata";
import { formatTime } from "(src)/utils/datetimeUtils";

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

	/* eslint-disable @typescript-eslint/naming-convention */
	private readonly mimeMapper: Record<string, string> = {
		".mp3": "audio/mpeg",
		".wav": "audio/wav",
		".m4a": "audio/mp4",
		".m4b": "audio/mp4",
		".ogg": "audio/ogg",
		".flac": "audio/flac"
	};
	/* eslint-enable @typescript-eslint/naming-convention */

	private readonly validExtensions = [".mp3", ".wav", ".m4a", ".m4b", ".ogg", ".flac"];

	public async getAudioFiles(filePath: string): Promise<AudioBookMetadata[]> {
		try {
			const dirents = await fs.readdir(filePath, {withFileTypes: true});
			const audioFiles = dirents
				.filter(dirent => dirent.isFile())
				.filter(dirent => this.validExtensions.includes(path.extname(dirent.name).toLowerCase()))
				.sort((a, b) => a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()))
			;

			const audioMetadataPromises = audioFiles.map(async (dirent) => {
				const filePathResolved = path.resolve(filePath, dirent.name);
				return this.parseAudioFile(filePathResolved, dirent.name);
			});

			return await Promise.all(audioMetadataPromises);
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
			const track = await this.parseAudioFile(filePathResolved, fileName);
			return [track];
		} catch (error) {
			logger.error("getAudioFile", error);
			return [];
		}
	}

	private async parseAudioFile(filePathResolved: string, fileName: string): Promise<AudioBookMetadata> {
		const extension = path.extname(fileName).toLowerCase();
		let length = 0;
		let chapters: AudioChapter[] | undefined;

		try {
			const metadata: IAudioMetadata = await mm.parseFile(
				filePathResolved, {duration: true, skipCovers: true, includeChapters: true})
			;
			length = metadata.format.duration ?? 0;
			if ([".m4b", ".m4a"].includes(extension) && metadata.format.chapters?.length) {
				const sampleRate = metadata.format.sampleRate ?? 44100;
				chapters = metadata.format.chapters.map(ch => ({
					title: ch.title,
					startTimeInSeconds: ch.sampleOffset / sampleRate
				}));
			}
		} catch (error) {
			logger.error(`Could not read metadata for file: "${filePathResolved}"`, error);
		}

		return {
			title: fileName,
			src: filePathResolved,
			type: this.mimeMapper[extension] ?? "audio/mpeg",
			length: formatTime(length),
			chapters
		};
	}
}

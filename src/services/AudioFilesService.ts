import path from "path";
import shell from "shelljs";
import fs from "fs-extra";
import * as unrar from "node-unrar-js";
import { extractFull } from "node-7z";
import sharp from "sharp";
import { exec } from "child_process";
import util from "util";
import unzipper from "unzipper";
import { v4 as uuidv4 } from "uuid";
import * as mm from "music-metadata";
import { IAudioMetadata } from "music-metadata";

import { Logger } from "(src)/helpers/Logger";
import { AudioBookMetadata } from "(src)/models/interfaces/AudioBookMetadata";
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

	public async getAudioFiles(filePath: string): Promise<AudioBookMetadata[]> {
		// logger.info(`getAudioFiles: '${filePath}'`);
		try {
			const validExtensions = [".mp3", ".wav", ".m4a", ".m4b", ".ogg", ".flac"];

			/* eslint-disable @typescript-eslint/naming-convention */
			const mapper: Record<string, string> = {
				".mp3": "audio/mpeg",
				".wav": "audio/wav",
				".m4a": "audio/mp4",
				".m4b": "audio/mp4",
				".ogg": "audio/ogg",
				".flac": "audio/flac"
			};
			/* eslint-enable @typescript-eslint/naming-convention */

			const dirents = await fs.readdir(filePath, {withFileTypes: true});
			const audioFiles = dirents
				.filter(dirent => dirent.isFile())
				.filter(dirent => validExtensions.includes(path.extname(dirent.name).toLowerCase()))
				.sort((a, b) => a.name.toLocaleLowerCase().localeCompare(b.name.toLocaleLowerCase()))
			;

			const audioMetadataPromises = audioFiles.map(async (dirent) => {
				const extension = path.extname(dirent.name).toLowerCase();
				const filePathResolved = path.resolve(filePath, dirent.name);

				let length = 0;
				try {
					const metadata: IAudioMetadata = await mm.parseFile(
						filePathResolved, {duration: true, skipCovers: true})
					;
					// logger.info(`path: "${filePathResolved}" -  metadata: ${JSON.stringify(metadata)}`);
					length = metadata.format.duration ?? 0;
				} catch (error) {
					logger.error(`Could not read metadata for file: "${filePathResolved}"`, error);
				}

				// logger.info(`Audio file: "${dirent.name}" - ${length} seconds - formatted: ${formatTime(length)}`);

				return {
					title: dirent.name,
					src: filePathResolved,
					type: mapper[extension] ?? "audio/mpeg",
					length: formatTime(length)
				};
			});

			return await Promise.all(audioMetadataPromises);
		} catch (error) {
			logger.error("getAudioFiles", error);

			return undefined;
		}
	}
}

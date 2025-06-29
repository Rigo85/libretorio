import { File } from "(src)/models/interfaces/File";
import { Logger } from "(src)/helpers/Logger";

const logger = new Logger("fileUtils");

export function getWebDetailsCoverId(file: File): string | number | undefined {
	try {
		const webDetails = JSON.parse(file.webDetails ?? "{}");

		return webDetails.cover_i;
	} catch (error) {
		logger.error("getWebDetailsCoverId", error);

		return undefined;
	}
}

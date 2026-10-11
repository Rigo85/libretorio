import { File } from "(src)/models/interfaces/File";
import { Logger } from "(src)/helpers/Logger";

const logger = new Logger("fileUtils");

export function getWebDetailsCoverId(file: File): string | number | undefined {
	try {
		const webDetails = JSON.parse(file.webDetails ?? "{}");

		const coverId = webDetails.cover_i;
		return (typeof coverId === "number" || typeof coverId === "string") && /^[1-9][0-9]*$/.test(String(coverId))
			? coverId : undefined;
	} catch (error) {
		logger.error("getWebDetailsCoverId", error);

		return undefined;
	}
}

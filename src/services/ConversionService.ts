import path from "path";
import fs from "fs-extra";
import { exec } from "child_process";
import util from "util";
import { Logger } from "(src)/helpers/Logger";
import { ConventToPdfUtilFunction, ConvertData, ConvertToPdfResponse } from "(src)/models/interfaces/ConversionTypes";

const execPromise = util.promisify(exec);
const logger = new Logger("ConversionService");

export class ConversionService {
	private static instance: ConversionService;

	private constructor() {
	}

	public static getInstance(): ConversionService {
		if (!ConversionService.instance) {
			ConversionService.instance = new ConversionService();
		}
		return ConversionService.instance;
	}

	public async convertWithCalibreToPdf(data: { filePath: string; id: string }): Promise<ConvertToPdfResponse> {
		logger.info(`convertWithCalibreToPdf: '${JSON.stringify(data)}'`);

		const pdfDirPath = path.join(__dirname, "..", "public", "cache", data.id);
		const pdfPath = path.join(pdfDirPath, `${data.id}.pdf`);
		const calibrePath = path.join(__dirname, "calibre", "ebook-convert");
		const command = `${calibrePath} "${data.filePath}" "${pdfPath}"`;

		return await this.convertToPdf(data, command);
	}

	async convertOfficeToPdf(data: { filePath: string; id: string }): Promise<ConvertToPdfResponse> {
		logger.info(`convertOfficeToPdf: '${JSON.stringify(data)}'`);

		const pdfDirPath = path.join(__dirname, "..", "public", "cache", data.id);
		const command = `LD_LIBRARY_PATH=/usr/lib/libreoffice/program/ libreoffice --headless --convert-to pdf --outdir "${pdfDirPath}" "${data.filePath}"`;
		const utilFun = async (filePath: string, id: string) => {
			const pdfFile = path.join(pdfDirPath, `${data.id}.pdf`);
			const outputPdfFile = path.join(pdfDirPath, `${path.basename(data.filePath, path.extname(data.filePath))}.pdf`);
			fs.renameSync(outputPdfFile, pdfFile);
		};

		return await this.convertToPdf(data, command, utilFun);
	}

	async convertHtmlToPdf(data: { filePath: string; id: string }): Promise<ConvertToPdfResponse> {
		logger.info(`convertHtmlToPdf: '${JSON.stringify(data)}'`);

		const pdfDirPath = path.join(__dirname, "..", "public", "cache", data.id);
		const pdfPath = path.join(pdfDirPath, `${data.id}.pdf`);
		const command = `htmldoc --webpage --quiet -f "${pdfPath}" "${data.filePath}"`;

		return await this.convertToPdf(data, command);
	}

	async convertToPdf(data: ConvertData, command: string, utilFun?: ConventToPdfUtilFunction): Promise<ConvertToPdfResponse> {
		logger.info(`convertToPdf: '${JSON.stringify(data)}'`);

		try {
			if (!data?.filePath) {
				logger.info("The path to the file has not been provided.");
				return {error: "The path to the file has not been provided.", success: "ERROR"};
			}

			if (!fs.existsSync(data.filePath)) {
				logger.info(`The file does not exist: "${data.filePath}"`);
				return {error: `The file does not exist: "${data.filePath}"`, success: "ERROR"};
			}

			const pdfDirPath = path.join(__dirname, "..", "public", "cache", data.id);
			const pdfPath = path.join(pdfDirPath, `${data.id}.pdf`);

			if (fs.existsSync(pdfPath)) {
				return {pdfPath: path.join("/cache", data.id, `${data.id}.pdf`), success: "OK"};
			} else {
				fs.mkdirSync(pdfDirPath, {recursive: true});

				const {stderr} = await execPromise(command);
				if (stderr) {
					logger.error(`convertToPdf: ${stderr}`);
					// return {error: "An error has occurred converting to pdf.", success: "ERROR"};
				}

				if (utilFun) {
					await utilFun(data.filePath, data.id);
				}

				if (fs.existsSync(pdfPath)) {
					const stats = fs.statSync(pdfPath);
					if (stats.size > 0) {
						logger.info(`PDF file created successfully: '${pdfPath}'`);
						return {pdfPath: path.join("/cache", data.id, `${data.id}.pdf`), success: "OK"};
					} else {
						logger.error(`PDF file is empty: '${pdfPath}'`);
						return {error: "An error has occurred converting to pdf.", success: "ERROR"};
					}
				} else {
					logger.error(`PDF file not found after conversion: '${pdfPath}'`);
					return {error: "An error has occurred converting to pdf.", success: "ERROR"};
				}
			}
		} catch (error) {
			logger.error("convertToPdf", error);

			return {success: "ERROR", error: error.message || "An error has occurred converting to pdf."};
		}
	}
}
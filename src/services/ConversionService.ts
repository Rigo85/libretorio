import path from "path";
import fs from "fs-extra";
import { execFile } from "child_process";
import util from "util";
import { Logger } from "(src)/helpers/Logger";
import { ConventToPdfUtilFunction, ConvertData, ConvertToPdfResponse } from "(src)/models/interfaces/ConversionTypes";

const execFilePromise = util.promisify(execFile);
const logger = new Logger("ConversionService");

interface ExecConfig {
	bin: string;
	args: string[];
	env?: NodeJS.ProcessEnv;
}

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
		logger.info(`convertWithCalibreToPdf: '${JSON.stringify({id: data.id})}'`);

		const pdfDirPath = path.join(__dirname, "..", "public", "cache", data.id);
		const pdfPath = path.join(pdfDirPath, `${data.id}.pdf`);
		const calibrePath = path.join(__dirname, "calibre", "ebook-convert");

		return await this.convertToPdf(data, {bin: calibrePath, args: [data.filePath, pdfPath]});
	}

	async convertOfficeToPdf(data: { filePath: string; id: string }): Promise<ConvertToPdfResponse> {
		logger.info(`convertOfficeToPdf: '${JSON.stringify({id: data.id})}'`);

		const pdfDirPath = path.join(__dirname, "..", "public", "cache", data.id);
		const utilFun = async (_filePath: string, _id: string) => {
			const pdfFile = path.join(pdfDirPath, `${data.id}.pdf`);
			const outputPdfFile = path.join(pdfDirPath, `${path.basename(data.filePath, path.extname(data.filePath))}.pdf`);
			fs.renameSync(outputPdfFile, pdfFile);
		};

		const execConfig: ExecConfig = {
			bin: "libreoffice",
			args: ["--headless", "--convert-to", "pdf", "--outdir", pdfDirPath, data.filePath],
			// eslint-disable-next-line @typescript-eslint/naming-convention
			env: {...process.env, LD_LIBRARY_PATH: "/usr/lib/libreoffice/program/"}
		};

		return await this.convertToPdf(data, execConfig, utilFun);
	}

	async convertHtmlToPdf(data: { filePath: string; id: string }): Promise<ConvertToPdfResponse> {
		logger.info(`convertHtmlToPdf: '${JSON.stringify({id: data.id})}'`);

		const pdfDirPath = path.join(__dirname, "..", "public", "cache", data.id);
		const pdfPath = path.join(pdfDirPath, `${data.id}.pdf`);

		return await this.convertToPdf(data, {bin: "htmldoc", args: ["--webpage", "--quiet", "-f", pdfPath, data.filePath]});
	}

	async convertToPdf(data: ConvertData, execConfig: ExecConfig, utilFun?: ConventToPdfUtilFunction): Promise<ConvertToPdfResponse> {
		logger.info(`convertToPdf: '${JSON.stringify({id: data.id})}'`);

		try {
			if (!data?.filePath) {
				logger.info("The path to the file has not been provided.");
				return {error: "The path to the file has not been provided.", success: "ERROR"};
			}

			if (!fs.existsSync(data.filePath)) {
				logger.info(`The file does not exist: "${data.filePath}"`);
				return {error: "The file does not exist.", success: "ERROR"};
			}

			const pdfDirPath = path.join(__dirname, "..", "public", "cache", data.id);
			const pdfPath = path.join(pdfDirPath, `${data.id}.pdf`);

			if (fs.existsSync(pdfPath)) {
				return {pdfPath: path.join("/cache", data.id, `${data.id}.pdf`), success: "OK"};
			} else {
				fs.mkdirSync(pdfDirPath, {recursive: true});

				const {stderr} = await execFilePromise(execConfig.bin, execConfig.args, {env: execConfig.env});
				if (stderr) {
					logger.error(`convertToPdf stderr: ${stderr}`);
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

			return {success: "ERROR", error: "An error has occurred converting to pdf."};
		}
	}
}

import path from "path";
import fs from "fs-extra";
import { Logger } from "(src)/helpers/Logger";
import { ConvertData, ConvertToPdfResponse } from "(src)/models/interfaces/ConversionTypes";
import { PostgresAdapter } from "(src)/db/PostgresAdapter";
import { config } from "(src)/config/configuration";
import { isRealPathWithinRoot } from "(src)/utils/filesystemUtils";

const logger = new Logger("ConversionService");

function validData(data: ConvertData): boolean {
	return typeof data?.filePath === "string" && path.isAbsolute(data.filePath) &&
		typeof data.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.id);
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

	public async getPreparedPdf(data: ConvertData): Promise<ConvertToPdfResponse> {
		const unavailable = (code: string, error: string): ConvertToPdfResponse => ({success: "ERROR", code, error});
		if (!validData(data)) return unavailable("PDF_INVALID_REQUEST", "Invalid conversion parameters.");
		try {
			const root = config.production.paths.booksRoot || path.join(config.production.paths.public, "books");
			if (!await isRealPathWithinRoot(data.filePath, root)) return unavailable("PDF_SOURCE_MISSING", "The source is no longer available.");
			const {rows} = await PostgresAdapter.getInstance().pool.query(
				`SELECT a.name,a."parentPath",a."fileKind",c.status,c.details
                FROM archive a LEFT JOIN document_conversions c ON c.archive_id=a.id
                WHERE a."coverId"=$1 LIMIT 1`, [data.id]);
			const row = rows[0];
			if (!row || await fs.realpath(path.join(row.parentPath, row.name)) !== await fs.realpath(data.filePath)) {
				return unavailable("PDF_INVALID_REQUEST", "File does not match the catalogue ID.");
			}
			const source = await fs.stat(data.filePath);
			const formats = ["doc", "docx", "ppt", "pptx", "xls", "xlsx", "rtf", "txt", "md", "html", "htm", "lit"];
			if (!(row.fileKind === "FILE" && source.isFile() && formats.includes(path.extname(row.name).slice(1).toLowerCase()))) {
				return unavailable("PDF_UNSUPPORTED", "This material has no PDF conversion.");
			}
			if (row.status === "failed") return unavailable("PDF_FAILED", "El scanner no pudo preparar el PDF. Se requiere revisar el fallo registrado.");
			if (row.status !== "ready") return unavailable("PDF_PENDING", "El PDF aun no esta preparado por el scanner. Intenta de nuevo despues del escaneo.");
			const cache = await fs.realpath(config.production.paths.cache);
			const directory = path.join(cache, data.id);
			if (await fs.realpath(directory) !== directory) return unavailable("PDF_UNAVAILABLE", "PDF cache is not available.");
			const pdf = path.join(directory, `${data.id}.pdf`);
			const info = await fs.lstat(pdf, {bigint: true});
			const signature = [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].map(String).join(":");
			if (!info.isFile() || info.size < 1n || signature !== row.details?.outputSignature) {
				return unavailable("PDF_STALE", "El PDF necesita ser regenerado por el scanner.");
			}
			return {success: "OK", pdfPath: `/cache/${data.id}/${data.id}.pdf`};
		} catch (error) {
			logger.error("getPreparedPdf", {id: data.id, error: error.message});
			return unavailable("PDF_UNAVAILABLE", "El PDF no esta disponible. No se inicia una conversion desde el lector.");
		}
	}
}

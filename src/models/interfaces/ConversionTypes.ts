export interface ConvertToPdfResponse {
	success: "OK" | "ERROR";
	error?: string;
	pdfPath?: string;
}

export interface ConvertData {
	filePath: string;
	id: string;
}

export type ConventToPdfUtilFunction = (filePath: string, coverId: string) => Promise<void>;


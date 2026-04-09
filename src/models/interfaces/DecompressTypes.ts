export interface DecompressResponse {
	success: "OK" | "ERROR";
	error?: string;
	code?: string;
	pages?: DecompressPages;
}

export interface DecompressPages {
	pages: any[];
	pageIndex: number;
	currentPagesLength: number;
	totalPages: number;
	index: number;
}

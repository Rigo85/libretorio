export enum FileKind {
	/* eslint-disable @typescript-eslint/naming-convention */
	FILE = "FILE",
	COMIC_MANGA = "COMIC-MANGA",
	EPUB = "EPUB",
	NONE = "NONE"
	/* eslint-enable @typescript-eslint/naming-convention */
}

export interface File {
	id?: number;
	name: string;
	parentPath: string;
	parentHash: string;
	size: string;
	coverId: string;
	localDetails?: string;
	webDetails?: string;
	customDetails?: boolean;
	fileKind: FileKind;
}

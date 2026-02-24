export interface AudioChapter {
	title: string;
	startTimeInSeconds: number;
}

export interface AudioBookMetadata {
	title: string;
	src: string;
	type: string;
	length: string;
	chapters?: AudioChapter[];
}

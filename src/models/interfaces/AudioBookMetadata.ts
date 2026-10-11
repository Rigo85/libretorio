export interface AudioChapter {
	title: string;
	startTimeInSeconds: number;
	endTimeInSeconds?: number;
}

export interface AudioBookMetadata {
	title: string;
	src: string;
	type: string;
	length: string;
	chapters?: AudioChapter[];
	durationSeconds?: number;
	metadataStatus?: "ready" | "needs_review" | "failed" | "pending" | "processing" | "stale" | "unavailable" | "skipped";
}

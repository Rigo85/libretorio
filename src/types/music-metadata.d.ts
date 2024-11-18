declare module "music-metadata" {
	export function parseFile(filePath: string): Promise<{ format: { duration?: number } }>;
}

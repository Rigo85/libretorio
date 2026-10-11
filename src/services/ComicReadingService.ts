import {ReadingError, ReadingSource} from "./ReadingSource";
import {ComicCacheReaderService} from "./ComicCacheReaderService";

export async function comicReadingPage(input: any): Promise<any> {
	const {archiveId, id, index, sourceRevision} = input;
	if (!Number.isSafeInteger(archiveId) || archiveId < 1 || !Number.isSafeInteger(index) || index < 0 || index > 9999 ||
		(sourceRevision !== undefined && (typeof sourceRevision !== "string" || !/^[a-f0-9]{64}$/.test(sourceRevision)))) throw new ReadingError(400, "INVALID_COMIC_REQUEST");
	const source = new ReadingSource(), item = await source.item(archiveId);
	if (id !== item.coverId) throw new ReadingError(400, "MATERIAL_CHANGED");
	const before = await source.resolve(item, "comic", {chunk: index});
	if (sourceRevision && before.revision !== sourceRevision) throw new ReadingError(409, "SOURCE_CHANGED");
	const result = await ComicCacheReaderService.getInstance().getMorePages(id, index), chunk = result.pages;
	if (result.success !== "OK" || !chunk) throw new ReadingError(409, "COMIC_CACHE_MISSING");
	if (chunk.index !== index || !Number.isSafeInteger(chunk.pageIndex) || chunk.pageIndex < 1 ||
		!Number.isSafeInteger(chunk.totalPages) || chunk.totalPages < 1 || chunk.totalPages > 1000000 ||
		!Array.isArray(chunk.pages) || !chunk.pages.length || chunk.currentPagesLength !== chunk.pages.length ||
		chunk.pageIndex + chunk.pages.length - 1 > chunk.totalPages ||
		(before.comic?.totalPages !== undefined && chunk.totalPages !== before.comic.totalPages) ||
		!chunk.pages.every(page => typeof page === "string" && /^data:image\/[a-z0-9.+-]+;base64,/i.test(page))) throw new ReadingError(409, "COMIC_CACHE_INVALID");
	const after = await source.resolve(item, "comic", {chunk: index});
	if (after.revision !== before.revision) throw new ReadingError(409, "SOURCE_CHANGED");
	return {success: "OK", pages: chunk, sourceRevision: before.revision};
}

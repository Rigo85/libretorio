import { WebSocket } from "ws";
import fs from "fs-extra";

import { Logger } from "(src)/helpers/Logger";
import { BooksService } from "(src)/services/BooksService";
import { OpenLibraryService } from "(src)/services/OpenLibraryService";
import { AudioFilesService } from "(src)/services/AudioFilesService";
import { ConversionService } from "(src)/services/ConversionService";
import { ComicCacheReaderService } from "(src)/services/ComicCacheReaderService";
import { CacheArtifactStateRepository } from "(src)/repositories/CacheArtifactStateRepository";
import { isRealPathWithinRoot } from "(src)/utils/filesystemUtils";
import { DecompressResponse } from "(src)/models/interfaces/DecompressTypes";
import { ExtendedWebSocket, WebsocketAction } from "(src)/models/interfaces/WebSocketTypes";
import { AuditLogsService } from "(src)/services/AuditLogsService";
import { validateSession } from "./validateSession";
import { FileRepository } from "(src)/repositories/FileRepository";
import path from "path";
import { config } from "(src)/config/configuration";
import { comicReadingPage } from "(src)/services/ComicReadingService";
import { ReadingError } from "(src)/services/ReadingSource";

const logger = new Logger("Book Service");
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function validateFilePath(filePath: unknown): Promise<boolean> {
	if (typeof filePath !== "string" || !path.isAbsolute(filePath)) return false;
	return isRealPathWithinRoot(filePath, config.production.paths.booksRoot || path.join(config.production.paths.public, "books"));
}

function sanitizePaginationInt(value: unknown, defaultVal: number, min: number, max: number): number {
	const n = parseInt(String(value ?? defaultVal), 10);
	if (isNaN(n)) return defaultVal;
	return Math.min(max, Math.max(min, n));
}

export async function onMessageEvent(message: any, ws: ExtendedWebSocket) {
	if (!await validateSession(ws)) return;
	const {userId} = ws.session;

	let messageObj: { event: string; data: any };
	let event: WebsocketAction = "default";

	try {
		messageObj = JSON.parse(message);
		if (!messageObj || typeof messageObj.event !== "string" || messageObj.event.length > 64) {
			throw new Error("Invalid event envelope");
		}
		event = messageObj.event as WebsocketAction;
		if (event !== "ping") {
			ws.lastActivityTime = Date.now();
			AuditLogsService.getInstance().logAction(userId, event, messageObj);
		}
	} catch (error) {
		sendMessage(ws, {event: "errors", data: {errors: ["Invalid message."]}});
		return;
	}

	const eventHandlers: Record<WebsocketAction, () => Promise<void>> = {
		"ls": async () => {
			await onListEvent(ws, messageObj);
		},
		"search": async () => {
			if (!ws.session.isAdmin) {
				sendMessage(ws, {event: "search_details", data: []});
				return;
			}
			await onSearchEvent(ws, messageObj);
		},
		// eslint-disable-next-line @typescript-eslint/naming-convention
		"search_text": async () => {
			await onSearchTextEvent(ws, messageObj);
		},
		"update": async () => {
			if (!ws.session.isAdmin) {
				sendMessage(ws, {event: "update", data: {response: false}});
				return;
			}
			await onUpdateEvent(ws, messageObj);
		},
		"decompress": async () => {
			await onDecompressEvent(ws, messageObj);
		},
		// eslint-disable-next-line @typescript-eslint/naming-convention
		"convert_to_pdf": async () => {
			await onConvertToPdfEvent(ws, messageObj);
		},
		// eslint-disable-next-line @typescript-eslint/naming-convention
		"get_more_pages": async () => {
			await onGetMorePagesEvent(ws, messageObj);
		},
		// eslint-disable-next-line @typescript-eslint/naming-convention
		"get_audio_book": async () => {
			await onGetAudioBookEvent(ws, messageObj);
		},
		// eslint-disable-next-line @typescript-eslint/naming-convention
		"log_action": async () => {
			// ignore log_action event here.
		},
		"ping": async () => {
			// heartbeat desde el cliente — se ignora silenciosamente
		},
		"default": async () => {
			ws.send("{\"event\":\"errors\", \"data\": {\"errors\":[\"An error has occurred. Invalid event kind.\"]}}");
		}
	};

	if (!Object.prototype.hasOwnProperty.call(eventHandlers, event)) {
		event = "default";
	}

	await eventHandlers[event]().catch(e => logger.error("Unhandled event error:", e));
}

async function onListEvent(ws: WebSocket, messageObj: { event: string; data: any }) {
	try {
		const parentHash = messageObj.data?.parentHash;
		const offset = sanitizePaginationInt(messageObj.data?.offset, 0, 0, 1_000_000);
		const limit = sanitizePaginationInt(messageObj.data?.limit, 50, 1, 200);
		const cleanUp = messageObj.data?.cleanUp ?? false;
		const scanResult = await BooksService.getInstance().getBooksList(offset, limit, cleanUp, parentHash);

		sendMessage(ws, {event: "list", data: scanResult});
	} catch (error) {
		logger.error("onListEvent", error);
	}
}

async function onSearchEvent(ws: WebSocket, messageObj: { event: string; data: any }) {
	try {
		const bookInfo = await OpenLibraryService.getInstance().searchBookInfoOpenLibrary(messageObj.data);
		sendMessage(ws, {event: "search_details", data: bookInfo});
	} catch (error) {
		logger.error("onSearchEvent", error);
	}
}

async function onGetAudioBookEvent(ws: WebSocket, messageObj: { event: string; data: any }) {
	const requestId = typeof messageObj.data?.requestId === "string" && /^[a-zA-Z0-9-]{1,64}$/.test(messageObj.data.requestId)
		? messageObj.data.requestId : undefined;
	const reply = (data: unknown[], code?: string) => sendMessage(ws, {event: "get_audio_book", data, requestId, code});
	try {
		const filePath = messageObj?.data?.filePath;

		if (!await validateFilePath(filePath)) {
			reply([], "AUDIO_UNAVAILABLE");
			logger.error(`onGetAudioBookEvent: invalid or disallowed path "${filePath}"`);
			return;
		}

		const stat = await fs.stat(filePath);
		const audioBook = stat.isDirectory()
			? await AudioFilesService.getInstance().getAudioFiles(filePath)
			: await AudioFilesService.getInstance().getAudioFile(filePath);
		reply(audioBook);
	} catch (error) {
		logger.error("onGetAudioBookEvent", error);
		reply([], "AUDIO_UNAVAILABLE");
	}
}

async function onSearchTextEvent(ws: WebSocket, messageObj: { event: string; data: any }) {
	try {
		const offset = sanitizePaginationInt(messageObj.data?.offset, 0, 0, 1_000_000);
		const limit = sanitizePaginationInt(messageObj.data?.limit, 50, 1, 200);
		const searchText = messageObj.data?.searchText;

		if (!searchText) {
			sendMessage(ws, {event: "errors", data: {errors: ["An error has occurred. Invalid search text."]}});

			return;
		}
		const scanResult = await BooksService.getInstance().searchBooksByTextOnDb(searchText, offset, limit);
		sendMessage(ws, {event: "list", data: scanResult});
	} catch (error) {
		logger.error("onSearchTextEvent", error);
	}
}

async function onUpdateEvent(ws: WebSocket, messageObj: { event: string; data: any }) {
	try {
		const response = await BooksService.getInstance().updateBooksDetails(messageObj.data);
		sendMessage(ws, {event: "update", data: {response}});
	} catch (error) {
		logger.error("onUpdateEvent", error);
	}
}

async function onConvertToPdfEvent(ws: WebSocket, messageObj: { event: string; data: any }) {
	const requestId = typeof messageObj.data?.requestId === "string" && /^[a-zA-Z0-9-]{1,64}$/.test(messageObj.data.requestId)
		? messageObj.data.requestId : undefined;
	const reply = (data: object) => sendMessage(ws, {event: "convert_to_pdf", data: {...data, requestId}});
	try {
		const filePath = messageObj.data?.filePath;

		const id = messageObj.data?.id;
		if (typeof id !== "string" || !UUID_REGEX.test(id) || !await validateFilePath(filePath)) {
			reply({success: "ERROR", error: "Invalid file path."});
			logger.error(`onConvertToPdfEvent: invalid or disallowed path "${filePath}"`);
			return;
		}

		const cataloguedPath = await FileRepository.getInstance().findPathByCoverId(id);
		if (!cataloguedPath || await fs.realpath(cataloguedPath) !== await fs.realpath(filePath)) {
			reply({success: "ERROR", error: "File does not match the catalogue ID."});
			return;
		}
		const response = await ConversionService.getInstance().getPreparedPdf({filePath, id});
		reply(response);
	} catch (error) {
		logger.error("onConvertToPdfEvent", error);
		reply({success: "ERROR", error: "An error has occurred."});
	}
}

async function onDecompressEvent(ws: WebSocket, messageObj: { event: string; data: any }) {
	try {
		const coverId = messageObj?.data?.id;

		if (!coverId || typeof coverId !== "string" || !UUID_REGEX.test(coverId)) {
			sendMessage(ws, {event: "decompress", data: {success: "ERROR", error: "Invalid ID."}});
			return;
		}

		const readerReady = await CacheArtifactStateRepository.getInstance().isReaderReady(coverId);
		if (!readerReady) {
			sendMessage(ws, {
				event: "decompress",
				data: {
					success: "ERROR",
					code: "COMIC_CACHE_MISSING",
					error: "This file is download-only."
				}
			});
			return;
		}

		const response = await ComicCacheReaderService.getInstance().getInitialPages(coverId);
		sendMessage(ws, {event: "decompress", data: {...response}});
		if (response?.pages) response.pages = undefined;
	} catch (error) {
		logger.error("onDecompressEvent", error);

		sendMessage(ws, {
			event: "decompress",
			data: {success: "ERROR", error: "An error has occurred."}
		});
	}
}

async function onGetMorePagesEvent(ws: WebSocket, messageObj: { event: string; data: any }) {
	if (messageObj?.data?.requestId !== undefined) {
		const {requestId, archiveId, id} = messageObj.data;
		if (typeof requestId !== "string" || !UUID_REGEX.test(requestId)) return;
		try {
			const result = await comicReadingPage(messageObj.data);
			sendMessage(ws, {event: "decompress", data: {...result, requestId, archiveId, id}});
		} catch (error) {
			sendMessage(ws, {event: "decompress", data: {success: "ERROR", requestId, archiveId, id,
				code: error instanceof ReadingError ? error.code : "COMIC_UNAVAILABLE"}});
		}
		return;
	}
	try {
		const id: unknown = messageObj?.data?.id;
		const index = sanitizePaginationInt(messageObj?.data?.index, 0, 0, 9999);

		if (!id || typeof id !== "string" || !UUID_REGEX.test(id)) {
			sendMessage(ws, {event: "decompress", data: {success: "ERROR", error: "Invalid ID."}});
			return;
		}

		const response = await ComicCacheReaderService.getInstance().getMorePages(id, index);
		sendMessage(ws, {event: "decompress", data: {...response}});
		if (response?.pages) response.pages = undefined;
	} catch (error) {
		logger.error("onGetMorePagesEvent", error);

		sendMessage(ws, {
			event: "decompress",
			data: {success: "ERROR", error: "An error has occurred."}
		});
	}
}

function sendMessage(ws: WebSocket, data: any) {
	if (ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify(data), (error: Error) => {
			if (error) {
				logger.error("Error sending data:", error);
			}
		});
	}
}

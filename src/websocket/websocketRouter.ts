import { WebSocket } from "ws";

import { Logger } from "(src)/helpers/Logger";
import { BooksService } from "(src)/services/BooksService";
import { OpenLibraryService } from "(src)/services/OpenLibraryService";
import { AudioFilesService } from "(src)/services/AudioFilesService";
import { ConversionService } from "(src)/services/ConversionService";
import { DecompressService } from "(src)/services/DecompressService";
import { detectCompressionType, isPathWithinRoot } from "(src)/utils/filesystemUtils";
import { DecompressResponse } from "(src)/models/interfaces/DecompressTypes";
import { FileKind } from "(src)/models/interfaces/File";
import { ConvertToPdfResponse } from "(src)/models/interfaces/ConversionTypes";
import { ExtendedWebSocket, WebsocketAction } from "(src)/models/interfaces/WebSocketTypes";
import { AuditLogsService } from "(src)/services/AuditLogsService";
import { UserRepository } from "(src)/repositories/UserRepository";
import { config } from "(src)/config/configuration";

const logger = new Logger("Book Service");
const SESSION_CACHE_TTL_MS = 30_000;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateFilePath(filePath: unknown): filePath is string {
	if (!filePath || typeof filePath !== "string") return false;
	const root = config.production.paths.booksRoot;
	if (!root) return true; // no root configured — skip validation
	return isPathWithinRoot(filePath, root);
}

function sanitizePaginationInt(value: unknown, defaultVal: number, min: number, max: number): number {
	const n = parseInt(String(value ?? defaultVal), 10);
	if (isNaN(n)) return defaultVal;
	return Math.min(max, Math.max(min, n));
}

export async function onMessageEvent(message: any, ws: ExtendedWebSocket) {
	const {userId} = ws.session;

	const now = Date.now();
	const cacheValid = ws.cachedSessionId !== undefined && ws.sessionCacheExpiry !== undefined && now < ws.sessionCacheExpiry;

	if (!cacheValid) {
		try {
			const storedSessionId = await UserRepository.getInstance().getSessionId(userId);
			ws.cachedSessionId = storedSessionId;
			ws.sessionCacheExpiry = now + SESSION_CACHE_TTL_MS;
		} catch (error) {
			logger.error("Error verifying WebSocket session:", error);
		}
	}

	if (ws.cachedSessionId !== undefined && ws.cachedSessionId !== (ws.session as any)?.req.sessionID) {
		logger.info(`Terminating WebSocket connection for user '${userId}' due to session change.`);

		sendMessage(ws, {
			event: "session_expired",
			data: {message: "Your session has been invalidated by a login on another device."}
		});

		ws.terminate();
		return;
	}

	let messageObj: { event: string; data: any };
	let event: WebsocketAction = "default";

	try {
		messageObj = JSON.parse(message);
		event = messageObj.event as WebsocketAction;
		if (event !== "ping") {
			AuditLogsService.getInstance().logAction(userId, event, messageObj);
		}
	} catch (error) {
		logger.error("onMessageEvent", error);
	}

	const eventHandlers: Record<WebsocketAction, () => Promise<void>> = {
		"ls": async () => {
			await onListEvent(ws, messageObj);
		},
		"search": async () => {
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

	if (!eventHandlers[event]) {
		event = "default";
	}

	eventHandlers[event]().catch(e => logger.error("Unhandled event error:", e));
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
	try {
		const filePath = messageObj?.data?.filePath;

		if (!validateFilePath(filePath)) {
			sendMessage(ws, {event: "get_audio_book", data: []});
			logger.error(`onGetAudioBookEvent: invalid or disallowed path "${filePath}"`);
			return;
		}

		const audioBook = await AudioFilesService.getInstance().getAudioFiles(filePath);
		sendMessage(ws, {event: "get_audio_book", data: audioBook});
	} catch (error) {
		logger.error("onGetAudioBookEvent", error);
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
	try {
		const filePath = messageObj.data?.filePath;

		if (!validateFilePath(filePath)) {
			sendMessage(ws, {event: "convert_to_pdf", data: {success: "ERROR", error: "Invalid file path."}});
			logger.error(`onConvertToPdfEvent: invalid or disallowed path "${filePath}"`);
			return;
		}

		const extension = filePath.split(".").pop() ?? "";
		const dispatch: Record<string, (data: { filePath: string }) => Promise<ConvertToPdfResponse>> = {
			"epub": ConversionService.getInstance().convertWithCalibreToPdf.bind(ConversionService.getInstance()),
			"doc": ConversionService.getInstance().convertOfficeToPdf.bind(ConversionService.getInstance()),
			"docx": ConversionService.getInstance().convertOfficeToPdf.bind(ConversionService.getInstance()),
			"ppt": ConversionService.getInstance().convertOfficeToPdf.bind(ConversionService.getInstance()),
			"pptx": ConversionService.getInstance().convertOfficeToPdf.bind(ConversionService.getInstance()),
			"xls": ConversionService.getInstance().convertOfficeToPdf.bind(ConversionService.getInstance()),
			"xlsx": ConversionService.getInstance().convertOfficeToPdf.bind(ConversionService.getInstance()),
			"rtf": ConversionService.getInstance().convertOfficeToPdf.bind(ConversionService.getInstance()),
			"txt": ConversionService.getInstance().convertWithCalibreToPdf.bind(ConversionService.getInstance()),
			"md": ConversionService.getInstance().convertWithCalibreToPdf.bind(ConversionService.getInstance()),
			"html": ConversionService.getInstance().convertHtmlToPdf.bind(ConversionService.getInstance()),
			"htm": ConversionService.getInstance().convertHtmlToPdf.bind(ConversionService.getInstance()),
			"lit": ConversionService.getInstance().convertWithCalibreToPdf.bind(ConversionService.getInstance())
		};

		if (dispatch[extension]) {
			const response = await dispatch[extension](messageObj.data);
			sendMessage(ws, {event: "convert_to_pdf", data: {...response}});
		} else {
			sendMessage(ws, {
				event: "convert_to_pdf",
				data: {success: "ERROR", error: "An error has occurred. Invalid file extension kind."}
			});
		}
	} catch (error) {
		logger.error("onConvertToPdfEvent", error);
		sendMessage(ws, {
			event: "convert_to_pdf",
			data: {success: "ERROR", error: "An error has occurred."}
		});
	}
}

async function onDecompressEvent(ws: WebSocket, messageObj: { event: string; data: any }) {
	try {
		const filePath = messageObj?.data?.filePath;

		if (!validateFilePath(filePath)) {
			sendMessage(ws, {event: "decompress", data: {success: "ERROR", error: "Invalid file path."}});
			logger.error(`onDecompressEvent: invalid or disallowed path "${filePath}"`);
			return;
		}

		const extension = messageObj?.data?.fileKind === FileKind.FILE ?
			detectCompressionType(filePath) :
			messageObj?.data?.fileKind.toLowerCase();

		const dispatch: Record<string, (data: { filePath: string }) => Promise<DecompressResponse>> = {
			"cb7": DecompressService.getInstance().decompressCB7.bind(DecompressService.getInstance()),
			"cbr": DecompressService.getInstance().decompressRAR.bind(DecompressService.getInstance()),
			"cbz": DecompressService.getInstance().decompressZIP.bind(DecompressService.getInstance()),
			// eslint-disable-next-line @typescript-eslint/naming-convention
			"comic-manga": DecompressService.getInstance().gettingComicMangaImages.bind(DecompressService.getInstance())
		};

		if (dispatch[extension]) {
			const response = await dispatch[extension](messageObj.data);
			sendMessage(ws, {event: "decompress", data: {...response}});
		} else {
			sendMessage(ws, {
				event: "decompress",
				data: {success: "ERROR", error: "An error has occurred. Invalid file extension kind."}
			});
		}
	} catch (error) {
		logger.error("onDecompressEvent", error);

		sendMessage(ws, {
			event: "decompress",
			data: {success: "ERROR", error: "An error has occurred."}
		});
	}
}

async function onGetMorePagesEvent(ws: WebSocket, messageObj: { event: string; data: any }) {
	try {
		const id: unknown = messageObj?.data?.id;
		const index = sanitizePaginationInt(messageObj?.data?.index, 0, 0, 9999);

		if (!id || typeof id !== "string" || !UUID_REGEX.test(id)) {
			sendMessage(ws, {event: "decompress", data: {success: "ERROR", error: "Invalid ID."}});
			return;
		}

		const response = await DecompressService.getInstance().getMorePages(id, index);
		sendMessage(ws, {event: "decompress", data: {...response}});
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

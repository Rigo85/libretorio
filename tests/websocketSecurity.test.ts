import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { WebSocket } from "ws";
import { onMessageEvent } from "../src/websocket/websocketRouter";
import { ExtendedWebSocket } from "../src/models/interfaces/WebSocketTypes";

const mockSession = jest.fn<(...args: any[]) => Promise<any>>();
const mockList = jest.fn<(...args: any[]) => Promise<any>>();
const mockUpdate = jest.fn<(...args: any[]) => Promise<any>>();
const mockConvert = jest.fn<(...args: any[]) => Promise<any>>();
const mockPath = jest.fn<(...args: any[]) => Promise<any>>();
const mockAudio = jest.fn<(...args: any[]) => Promise<any>>();
const mockComic = jest.fn<(...args: any[]) => Promise<any>>();
const mockLegacyComic = jest.fn<(...args: any[]) => Promise<any>>();
jest.mock("../src/db/PostgresAdapter", () => ({PostgresAdapter: {getInstance: jest.fn()}}));
jest.mock("../src/services/ComicReadingService", () => ({comicReadingPage: (...args: any[]) => mockComic(...args)}));
jest.mock("../src/helpers/Logger", () => ({Logger: class {info() {} error() {}}}));
jest.mock("../src/repositories/UserRepository", () => ({UserRepository: {getInstance: () => ({getWebSocketSession: mockSession})}}));
jest.mock("../src/repositories/FileRepository", () => ({FileRepository: {getInstance: () => ({findPathByCoverId: mockPath})}}));
jest.mock("../src/services/BooksService", () => ({BooksService: {getInstance: () => ({getBooksList: mockList, updateBooksDetails: mockUpdate})}}));
jest.mock("../src/services/AuditLogsService", () => ({AuditLogsService: {getInstance: () => ({logAction: (): void => {}})}}));
jest.mock("../src/services/OpenLibraryService", () => ({}));
jest.mock("../src/services/AudioFilesService", () => ({AudioFilesService: {getInstance: () => ({getAudioFile: mockAudio, getAudioFiles: mockAudio})}}));
jest.mock("../src/services/ComicCacheReaderService", () => ({ComicCacheReaderService: {getInstance: () => ({getMorePages: mockLegacyComic})}}));
jest.mock("../src/repositories/CacheArtifactStateRepository", () => ({}));
jest.mock("../src/services/ConversionService", () => ({ConversionService: {getInstance: () => ({
	getPreparedPdf: mockConvert
})}}));
jest.mock("../src/config/configuration", () => ({config: {production: {paths: {booksRoot: "/library"}}}}));
jest.mock("../src/utils/filesystemUtils", () => ({isRealPathWithinRoot: async (p: string) => p.startsWith("/library/")}));
jest.mock("fs-extra", () => ({__esModule: true, default: {realpath: async (p: string) => p, stat: async () => ({isDirectory: () => false})}}));

describe("WebSocket authorization before dispatch", () => {
	let ws: ExtendedWebSocket;
	beforeEach(() => {
		jest.clearAllMocks();
		mockSession.mockResolvedValue({isAdmin: false});
		mockList.mockResolvedValue({files: [], total: 0});
		mockPath.mockResolvedValue("/library/book.epub");
		mockConvert.mockResolvedValue({success: "OK", pdfPath: "/cache/example.pdf"});
		ws = {readyState: WebSocket.OPEN, session: {userId: "user", isAdmin: false}, sessionID: "sid",
			lastActivityTime: Date.now(), send: jest.fn(), close: jest.fn()} as unknown as ExtendedWebSocket;
	});
	const send = (ws: ExtendedWebSocket, event: string, data: any = {}) => onMessageEvent(JSON.stringify({event, data}), ws);
	test.each([false, true])("correlates comic success and failure: %s", async failure => {
		const data = {archiveId: 1, id: "00000000-0000-4000-8000-000000000001", index: 2,
			requestId: "00000000-0000-4000-8000-000000000002"};
		if (failure) mockComic.mockRejectedValue(new Error("Unavailable"));
		else mockComic.mockResolvedValue({success: "OK", pages: {index: 2}});
		await send(ws, "get_more_pages", data);
		const reply = JSON.parse((ws.send as jest.Mock).mock.calls[0][0] as string);
		expect(reply.data).toMatchObject({archiveId: 1, id: data.id, requestId: data.requestId, success: failure ? "ERROR" : "OK"});
	});
	test("rejects revoked comic sessions and malformed correlation before reading", async () => {
		await send(ws, "get_more_pages", {requestId: "invalid"});
		mockSession.mockResolvedValue(undefined);
		await send(ws, "get_more_pages", {requestId: "00000000-0000-4000-8000-000000000002"});
		expect(mockComic).not.toHaveBeenCalled();
		expect(mockLegacyComic).not.toHaveBeenCalled();
	});
	test("preserves the old comic request contract", async () => {
		mockLegacyComic.mockResolvedValue({success: "OK", pages: {index: 0}});
		await send(ws, "get_more_pages", {id: "00000000-0000-4000-8000-000000000001", index: 0});
		expect(mockLegacyComic).toHaveBeenCalledTimes(1);
		expect(mockComic).not.toHaveBeenCalled();
	});

	test("validates on every command, without the previous 30-second cache", async () => {
		await send(ws, "ls");
		mockSession.mockResolvedValue(undefined);
		await send(ws, "ls");
		expect(mockSession).toHaveBeenCalledTimes(2);
		expect(mockList).toHaveBeenCalledTimes(1);
		expect(ws.close).toHaveBeenCalledWith(1008, "Session expired");
	});

	test("blocks dispatch on DB failure without claiming the session expired", async () => {
		mockSession.mockRejectedValue(new Error("DB unavailable"));
		await send(ws, "ls");
		expect(mockList).not.toHaveBeenCalled();
		expect(ws.send).not.toHaveBeenCalled();
		expect(ws.close).toHaveBeenCalledWith(1013, "Session validation unavailable");
	});

	test("checks inactivity before updating the activity timestamp", async () => {
		ws.lastActivityTime = Date.now() - 3_600_001;
		await send(ws, "ls");
		expect(mockList).not.toHaveBeenCalled();
		expect(ws.close).toHaveBeenCalledWith(1008, "Session expired");
	});
	test('HTTP playback activity keeps the existing WebSocket valid beyond its own idle hour', async () => {
		ws.lastActivityTime = Date.now() - 3_600_001;
		mockSession.mockResolvedValue({isAdmin: false, lastActivity: Date.now()});
		await send(ws, 'ls');
		expect(mockList).toHaveBeenCalledTimes(1);
		expect(ws.close).not.toHaveBeenCalled();
	});
	test('recent playback activity cannot keep a revoked session alive', async () => {
		mockSession.mockResolvedValue(undefined);
		await send(ws, 'ls');
		expect(mockList).not.toHaveBeenCalled();
		expect(ws.close).toHaveBeenCalledWith(1008, 'Session expired');
	});
	test('a recently connected socket cannot revive expired persisted activity', async () => {
		mockSession.mockResolvedValue({isAdmin:false, lastActivity:Date.now() - 3_600_001});
		await send(ws, 'ls');
		expect(mockList).not.toHaveBeenCalled();
		expect(ws.close).toHaveBeenCalledWith(1008, 'Session expired');
	});
	test.each(['ready', 'empty', 'error', 'invalid'])('correlates audio replies including %s', async state => {
		mockAudio.mockResolvedValue(state === 'ready' ? [{src: '/library/book.m4a'}] : []);
		if (state === 'error') mockAudio.mockRejectedValue(new Error('offline'));
		await send(ws, 'get_audio_book', {filePath: state === 'invalid' ? '/outside/file' : '/library/book.m4a', requestId: 'audio-123'});
		const response = JSON.parse((ws.send as jest.Mock).mock.calls[0][0] as string);
		expect(response.requestId).toBe('audio-123');
		expect(Array.isArray(response.data)).toBe(true);
		if (state === 'error' || state === 'invalid') expect(response.code).toBe('AUDIO_UNAVAILABLE');
	});

	test("refreshes admin permissions instead of trusting upgrade-time claims", async () => {
		ws.session.isAdmin = true;
		await send(ws, "update", {id: 1});
		expect(mockUpdate).not.toHaveBeenCalled();
		mockSession.mockResolvedValue({isAdmin: true});
		await send(ws, "update", {id: 1});
		expect(mockUpdate).toHaveBeenCalledTimes(1);
	});

	test("metadata search cannot write cover cache for a non-admin", async () => {
		await send(ws, "search", {title: "book"});
		expect(ws.send).toHaveBeenCalledWith(JSON.stringify({event: "search_details", data: []}), expect.any(Function));
	});

	test.each(["null", "{", "[]", '{"event":{}}', '{"event":"__proto__"}', '{"event":"constructor"}'])(
		"rejects malformed/unknown message %s without crashing", async payload => {
			await expect(onMessageEvent(payload, ws)).resolves.toBeUndefined();
			expect(mockList).not.toHaveBeenCalled();
		}
	);

	test.each(["../../outside", "bad-id", undefined])("rejects unsafe conversion ID %s before conversion", async id => {
		await send(ws, "convert_to_pdf", {filePath: "/library/book.epub", id});
		expect(mockConvert).not.toHaveBeenCalled();
		expect(mockPath).not.toHaveBeenCalled();
	});

	test("rejects mismatched catalogue ID and path", async () => {
		await send(ws, "convert_to_pdf", {filePath: "/library/other.epub", id: "00000000-0000-4000-8000-000000000001"});
		expect(mockConvert).not.toHaveBeenCalled();
	});

	test("preserves the PDF lookup contract including uppercase extensions", async () => {
		mockPath.mockResolvedValue("/library/book.EPUB");
		await send(ws, "convert_to_pdf", {filePath: "/library/book.EPUB", id: "00000000-0000-4000-8000-000000000001"});
		expect(mockConvert).toHaveBeenCalledTimes(1);
	});
	test.each(["ready", "failed", "invalid", "mismatch", "exception"])("correlates PDF replies for %s", async state => {
		mockConvert.mockResolvedValue(state === "failed" ? {success: "ERROR", code: "PDF_FAILED"} : {success: "OK", pdfPath: "/cache/example.pdf"});
		if (state === "exception") mockConvert.mockRejectedValue(new Error("DB unavailable"));
		if (state === "mismatch") mockPath.mockResolvedValue("/library/other.epub");
		await send(ws, "convert_to_pdf", {filePath: "/library/book.epub",
			id: state === "invalid" ? "bad" : "00000000-0000-4000-8000-000000000001", requestId: "lookup-123"});
		const response = JSON.parse((ws.send as jest.Mock).mock.calls[0][0] as string);
		expect(response.data.requestId).toBe("lookup-123");
	});
	test("passes catalogued EPUB directories without a filename extension to the read-only service", async () => {
		mockPath.mockResolvedValue("/library/expanded-book");
		await send(ws, "convert_to_pdf", {filePath: "/library/expanded-book", id: "00000000-0000-4000-8000-000000000001"});
		expect(mockConvert).toHaveBeenCalledTimes(1);
	});
});

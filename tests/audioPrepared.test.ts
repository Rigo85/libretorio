import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { AudioFilesService } from "../src/services/AudioFilesService";

const mockQuery = jest.fn<(...args: any[]) => Promise<any>>();
const mockParse = jest.fn<(...args: any[]) => Promise<any>>();
jest.mock("../src/db/PostgresAdapter", () => ({PostgresAdapter: {getInstance: () => ({pool: {query: mockQuery}})}}));
// Jest 29 cannot resolve the module-sync export used by Node 24.
jest.mock("music-metadata", () => ({parseFile: (...args: any[]) => mockParse(...args)}), {virtual: true});
jest.mock("../src/helpers/Logger", () => ({Logger: class {error() {}}}));
let root: string;
let savedFlag: string | undefined;
beforeEach(async () => {
	savedFlag = process.env.AUDIO_METADATA_FROM_DB;
	process.env.AUDIO_METADATA_FROM_DB = "true";
	root = await fs.mkdtemp(path.join(os.tmpdir(), "prepared-audio-"));
	mockQuery.mockReset(); mockParse.mockReset();
});
afterEach(async () => {
	if (savedFlag === undefined) delete process.env.AUDIO_METADATA_FROM_DB;
	else process.env.AUDIO_METADATA_FROM_DB = savedFlag;
	await fs.rm(root, {recursive: true, force: true});
});
async function row(name: string, relativePath = "") {
	const file = path.join(root, name);
	await fs.writeFile(file, "audio fixture");
	const resolved = await fs.realpath(file), info = await fs.stat(file, {bigint: true});
	return {relativePath, signature: JSON.stringify([resolved, info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].map(String)),
		status: "ready", duration: 100, details: {format: 'mov,mp4,m4a,3gp,3g2,mj2'},
		chapters: [{title: "Uno", startTimeInSeconds: 0, endTimeInSeconds: 100}]};
}
test.each(["one.m4a", "one.m4b"])("reads prepared single-file chapters for %s without parsing", async name => {
	mockQuery.mockResolvedValue({rows: [await row(name)]});
	const tracks = await AudioFilesService.getInstance().getAudioFile(path.join(root, name));
	expect(tracks[0]).toMatchObject({metadataStatus: "ready", type: "audio/mp4", chapters: [{title: "Uno"}]});
	expect(mockParse).not.toHaveBeenCalled();
});
test("folder tracks use independent keys in one query", async () => {
	mockQuery.mockResolvedValue({rows: [await row("one.m4a", "one.m4a"), await row("two.m4b", "two.m4b")]});
	const tracks = await AudioFilesService.getInstance().getAudioFiles(root);
	expect(tracks).toHaveLength(2);
	expect(tracks.every(t => t.metadataStatus === "ready")).toBe(true);
	expect(mockQuery).toHaveBeenCalledTimes(1);
	expect(mockParse).not.toHaveBeenCalled();
});
test("replacement invalidates chapters without on-demand extraction", async () => {
	const metadata = await row("one.m4b");
	await fs.writeFile(path.join(root, "one.m4b"), "new content");
	mockQuery.mockResolvedValue({rows: [metadata]});
	expect((await AudioFilesService.getInstance().getAudioFile(path.join(root, "one.m4b")))[0]).toMatchObject({metadataStatus: "stale"});
	expect(mockParse).not.toHaveBeenCalled();
});
test("database failure retains playable track without an extraction fallback", async () => {
	await row("one.m4b");
	mockQuery.mockRejectedValue(new Error("offline"));
	expect((await AudioFilesService.getInstance().getAudioFile(path.join(root, "one.m4b")))[0]).toMatchObject({metadataStatus: "unavailable", type: ""});
	expect(mockParse).not.toHaveBeenCalled();
});
test("retains independently validated chapters when container warnings need review", async () => {
	mockQuery.mockResolvedValue({rows: [{...await row("one.m4a"), status: "needs_review"}]});
	expect((await AudioFilesService.getInstance().getAudioFile(path.join(root, "one.m4a")))[0].chapters).toHaveLength(1);
});
test("missing metadata does not start a parser", async () => {
	await row("one.m4a");
	mockQuery.mockResolvedValue({rows: []});
	expect((await AudioFilesService.getInstance().getAudioFile(path.join(root, "one.m4a")))[0].metadataStatus).toBe("pending");
	expect(mockParse).not.toHaveBeenCalled();
});
test('ignores the legacy extraction flag and uses detected content, not the filename', async () => {
	process.env.AUDIO_METADATA_FROM_DB = 'false';
	mockQuery.mockResolvedValue({rows: [{...await row('one.m4b'), details: {format: 'mp3'}}]});
	expect((await AudioFilesService.getInstance().getAudioFile(path.join(root, 'one.m4b')))[0].type).toBe('audio/mpeg');
	expect(mockParse).not.toHaveBeenCalled();
});
test('does not claim a shared Matroska/WebM demuxer is necessarily WebM', async () => {
	mockQuery.mockResolvedValue({rows: [{...await row('one.m4a'), details: {format: 'matroska,webm', codec: 'opus'}}]});
	expect((await AudioFilesService.getInstance().getAudioFile(path.join(root, 'one.m4a')))[0].type).toBe('');
});
test.each(['failed', 'processing', 'pending'])('does not expose old chapters for %s metadata', async status => {
	mockQuery.mockResolvedValue({rows: [{...await row('one.m4a'), status}]});
	const track = (await AudioFilesService.getInstance().getAudioFile(path.join(root, 'one.m4a')))[0];
	expect(track.metadataStatus).toBe(status);
	expect(track.chapters).toBeUndefined();
	expect(track.durationSeconds).toBeUndefined();
});
test('omits files the scanner identified as non-audio without dropping other tracks', async () => {
	mockQuery.mockResolvedValue({rows: [await row('one.m4a', 'one.m4a'), {...await row('fake.mp3', 'fake.mp3'), status: 'skipped'}]});
	const tracks = await AudioFilesService.getInstance().getAudioFiles(root);
	expect(tracks.map(track => track.title)).toEqual(['one.m4a']);
});
test('a missing file is not advertised as playable', async () => {
	mockQuery.mockResolvedValue({rows: []});
	expect(await AudioFilesService.getInstance().getAudioFile(path.join(root, 'missing.m4a'))).toEqual([]);
});

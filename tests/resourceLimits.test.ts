import { beforeEach, expect, jest, test } from "@jest/globals";
import { PassThrough, Readable } from "stream";
import { downloadImage, convertToWebp } from "../src/utils/imageUtils";
import { getWebDetailsCoverId } from "../src/utils/fileUtils";
import { File } from "../src/models/interfaces/File";

const mockRequest = jest.fn<(...args: any[]) => Promise<any>>();
const mockExec = jest.fn();
const mockRemove = jest.fn<(...args: any[]) => Promise<any>>();
let mockWriter: PassThrough;
jest.mock("axios", () => ({__esModule: true, default: (...args: any[]) => mockRequest(...args)}));
jest.mock("child_process", () => ({execFileSync: (...args: any[]) => mockExec(...args)}));
jest.mock("fs-extra", () => ({__esModule: true, default: {
	createWriteStream: () => mockWriter, remove: (...args: any[]) => mockRemove(...args), removeSync: () => {}
}}));
jest.mock("../src/helpers/Logger", () => ({Logger: class {error() {}}}));

beforeEach(() => {
	jest.clearAllMocks();
	mockRemove.mockResolvedValue(undefined);
	mockWriter = new PassThrough();
	mockWriter.resume();
});
test("streams ordinary cover downloads with a timeout and abort signal", async () => {
	mockRequest.mockResolvedValue({data: Readable.from([Buffer.from("cover")])});
	await expect(downloadImage("https://covers.openlibrary.org/b/id/1-L.jpg", "/tmp/fixture.jpg")).resolves.toBeUndefined();
	expect(mockRequest.mock.calls[0][0].timeout).toBe(15_000);
	expect(mockRequest.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
});
test("rejects oversized streams and removes partial output", async () => {
	mockRequest.mockResolvedValue({data: Readable.from([Buffer.alloc(10 * 1024 * 1024 + 1)])});
	await expect(downloadImage("https://covers.openlibrary.org/b/id/1-L.jpg", "/tmp/fixture.jpg")).rejects.toThrow("download limit");
	expect(mockRemove).toHaveBeenCalledWith("/tmp/fixture.jpg");
});
test("passes image paths as arguments, never as shell syntax", () => {
	convertToWebp('/tmp/image"$(command).jpg');
	expect(mockExec).toHaveBeenCalledWith("cwebp", ["-q", "85", '/tmp/image"$(command).jpg', "-o", '/tmp/image"$(command).webp'], {stdio: "ignore", timeout: 30_000});
});
test.each(["../../escape", '1"$(command)', {}, -1, 0])("rejects unsafe cover ID %s", coverId => {
	expect(getWebDetailsCoverId({webDetails: JSON.stringify({cover_i: coverId})} as File)).toBeUndefined();
});
test.each([1234, "1234"])("preserves numeric cover ID %s", coverId => {
	expect(getWebDetailsCoverId({webDetails: JSON.stringify({cover_i: coverId})} as File)).toBe(coverId);
});

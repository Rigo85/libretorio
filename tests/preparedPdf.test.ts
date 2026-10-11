import fs from "fs-extra";
import path from "path";
import os from "os";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { ConversionService } from "../src/services/ConversionService";
import { config } from "../src/config/configuration";
import * as childProcess from "child_process";

const mockQuery = jest.fn<(...args: any[]) => Promise<any>>();
jest.mock("../src/db/PostgresAdapter", () => ({PostgresAdapter: {getInstance: () => ({pool: {query: mockQuery}})}}));
jest.mock("../src/helpers/Logger", () => ({Logger: class {info() {} error() {}}}));
jest.mock("../src/config/configuration", () => ({config: {production: {paths: {booksRoot: "", public: "", cache: ""}}}}));
jest.mock("child_process", () => ({execFile: jest.fn(), spawn: jest.fn(), exec: jest.fn()}));

describe("scanner-owned PDF lookup", () => {
	const id = "00000000-0000-4000-8000-000000000001";
	const service = ConversionService.getInstance();
	let home: string, books: string, cache: string, pdf: string, source: string, row: any;
	beforeEach(async () => {
		jest.clearAllMocks();
		home = await fs.mkdtemp(path.join(os.tmpdir(), "prepared-pdf-"));
		books = path.join(home, "books"); cache = path.join(home, "cache");
		await fs.ensureDir(books); await fs.ensureDir(path.join(cache, id));
		source = path.join(books, "book.TXT"); pdf = path.join(cache, id, `${id}.pdf`);
		await fs.writeFile(source, "source fixture"); await fs.writeFile(pdf, "%PDF-prepared-by-scanner");
		Object.assign(config.production.paths, {booksRoot: books, public: home, cache});
		const stat = await fs.lstat(pdf, {bigint:true});
		row = {name:"book.TXT",parentPath:books,fileKind:"FILE",status:"ready",details:{
			outputSignature:[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].map(String).join(":")}};
		mockQuery.mockResolvedValue({rows:[row]});
	});
	afterEach(async () => {
		expect(childProcess.execFile).not.toHaveBeenCalled();
		expect(childProcess.spawn).not.toHaveBeenCalled();
		expect(childProcess.exec).not.toHaveBeenCalled();
		for (const [sql] of mockQuery.mock.calls) expect(sql.trim()).toMatch(/^SELECT /);
		await fs.remove(home);
	});
	test("returns the existing URL only when ready and the disk signature matches", async () => {
		expect(await service.getPreparedPdf({id,filePath:source})).toEqual({success:"OK",pdfPath:`/cache/${id}/${id}.pdf`});
	});
	test.each([[undefined,"PDF_PENDING"],["processing","PDF_PENDING"],["failed","PDF_FAILED"]])(
		"does not adopt an existing PDF when state is %s", async (status,code) => {
			row.status=status;
			expect(await service.getPreparedPdf({id,filePath:source})).toMatchObject({success:"ERROR",code});
			expect(await fs.readFile(pdf,"utf8")).toBe("%PDF-prepared-by-scanner");
		});
	test("does not create a cache directory for pending work", async () => {
		await fs.remove(path.dirname(pdf)); row.status=undefined;
		expect(await service.getPreparedPdf({id,filePath:source})).toMatchObject({code:"PDF_PENDING"});
		expect(await fs.pathExists(path.dirname(pdf))).toBe(false);
	});
	test("rejects missing, empty, changed and symlinked PDFs without writing", async () => {
		await fs.remove(pdf);
		expect(await service.getPreparedPdf({id,filePath:source})).toMatchObject({success:"ERROR"});
		await fs.writeFile(pdf, "");
		expect(await service.getPreparedPdf({id,filePath:source})).toMatchObject({code:"PDF_STALE"});
		await fs.writeFile(pdf,"changed");
		expect(await service.getPreparedPdf({id,filePath:source})).toMatchObject({code:"PDF_STALE"});
		await fs.remove(pdf);await fs.symlink(source,pdf);
		expect(await service.getPreparedPdf({id,filePath:source})).toMatchObject({code:"PDF_STALE"});
	});
	test("rejects a symlinked cache directory", async () => {
		await fs.remove(path.dirname(pdf));await fs.symlink(books,path.dirname(pdf));
		expect(await service.getPreparedPdf({id,filePath:source})).toMatchObject({code:"PDF_UNAVAILABLE"});
	});
	test("does not offer conversions for EPUB directories or files, even with a legacy ready PDF", async () => {
		row.name="expanded";row.fileKind="EPUB";
		source=path.join(books,row.name);await fs.ensureDir(source);
		expect(await service.getPreparedPdf({id,filePath:source})).toMatchObject({code:"PDF_UNSUPPORTED"});
		row.name="book.EPUB";row.fileKind="FILE";
		source=path.join(books,row.name);await fs.writeFile(source,"epub fixture");
		expect(await service.getPreparedPdf({id,filePath:source})).toMatchObject({code:"PDF_UNSUPPORTED"});
	});
	test("rejects invalid IDs, source escapes and ID/path mismatches", async () => {
		expect(await service.getPreparedPdf({id:"../outside",filePath:source})).toMatchObject({code:"PDF_INVALID_REQUEST"});
		const outside=path.join(home,"outside.epub");await fs.writeFile(outside,"outside");
		expect(await service.getPreparedPdf({id,filePath:outside})).toMatchObject({code:"PDF_SOURCE_MISSING"});
		const other=path.join(books,"other.epub");await fs.writeFile(other,"other");
		expect(await service.getPreparedPdf({id,filePath:other})).toMatchObject({code:"PDF_INVALID_REQUEST"});
	});
	test("does not expose conversion for an audiobook, comic or original PDF", async () => {
		for (const kind of ["AUDIOBOOK","COMIC-MANGA"]) {
			row.fileKind=kind;
			expect(await service.getPreparedPdf({id,filePath:source})).toMatchObject({code:"PDF_UNSUPPORTED"});
		}
		row.fileKind="FILE";row.name="original.pdf";source=path.join(books,row.name);await fs.writeFile(source,"%PDF-original");
		expect(await service.getPreparedPdf({id,filePath:source})).toMatchObject({code:"PDF_UNSUPPORTED"});
	});
	test("returns unavailable on DB failure without starting a converter", async () => {
		mockQuery.mockRejectedValue(new Error("database unavailable"));
		expect(await service.getPreparedPdf({id,filePath:source})).toMatchObject({success:"ERROR",code:"PDF_UNAVAILABLE"});
	});
});

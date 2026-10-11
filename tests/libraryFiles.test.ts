import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from "@jest/globals";
import express from "express";
import session from "express-session";
import { createServer, request, Server } from "http";
import { AddressInfo } from "net";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { libraryFilesMiddleware } from "../src/middlewares/libraryFilesMiddleware";
import { lastActivityMiddleware } from "../src/middlewares/lastActivityMiddleware";
import { singleSessionMiddleware } from "../src/middlewares/singleSessionMiddleware";
import { appStaticMiddleware } from "../src/middlewares/appStaticMiddleware";

const mockSessions = new Map<string, string>();
let mockDbUnavailable = false;
jest.mock("../src/repositories/UserRepository", () => ({
	UserRepository: {getInstance: () => ({getSessionId: async (id: string) => {
		if (mockDbUnavailable) throw new Error("Synthetic DB failure");
		return mockSessions.get(id);
	}})}
}));
jest.mock("../src/helpers/Logger", () => ({Logger: class {info() {} error() {}}}));

describe("authenticated library files", () => {
	let directory: string;
	let server: Server;
	let port: number;
	const legacyPath = "/home/fixture/Libretorio-Scanner/dist/public/books";
	const bytes = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz");
	const store = new session.MemoryStore();

	function send(url: string, options: {cookie?: string; method?: string; headers?: Record<string, string>} = {}) {
		return new Promise<{status: number; headers: import("http").IncomingHttpHeaders; body: Buffer}>((resolve, reject) => {
			const req = request({
				hostname: "127.0.0.1", port, path: url, method: options.method ?? "GET",
				headers: {...options.headers, ...(options.cookie ? {Cookie: options.cookie} : {})}
			}, res => {
				const chunks: Buffer[] = [];
				res.on("data", chunk => chunks.push(chunk));
				res.on("end", () => resolve({status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks)}));
				res.on("error", reject);
			});
			req.on("error", reject);
			req.end();
		});
	}

	async function login(expired = false) {
		const response = await send(`/fixture-login${expired ? "?expired=1" : ""}`, {method: "POST"});
		return response.headers["set-cookie"]![0].split(";")[0];
	}

	beforeAll(async () => {
		directory = await mkdtemp(path.join(tmpdir(), "libretorio-auth-test-"));
		for (const folder of ["books", "cache", "covers", "temp_covers", "assets"]) {
			await mkdir(path.join(directory, folder));
			await writeFile(path.join(directory, folder, "sample.pdf"), bytes);
		}
		await writeFile(path.join(directory, "books", "sample.m4a"), bytes);
		await writeFile(path.join(directory, "books", "sample.epub"), bytes);
		await writeFile(path.join(directory, "books", "sample.html"), "<script>window.unsafeBook=true</script>");
		await writeFile(path.join(directory, "main.js"), "public app asset");
		await writeFile(path.join(directory, "main-A123BCDE.js"), "versioned app asset");
		await writeFile(path.join(directory, "index.html"), "app shell");
		await symlink(path.join(directory, "books"), path.join(directory, "assets", "alias"));
		await symlink("/etc/hostname", path.join(directory, "books", "escape.txt"));
		await symlink("/etc/hostname", path.join(directory, "assets", "escape.txt"));
		await writeFile(path.join(directory, "bookshelf.js"), "not a protected namespace");
		await mkdir(path.dirname(path.join(directory, legacyPath)), {recursive: true});
		await symlink(path.join(directory, "books"), path.join(directory, legacyPath));

		const app = express();
		app.use(session({secret: "local-test-only", resave: false, saveUninitialized: false, store}));
		// Test-only login: no credentials, production database or production server.
		app.post("/fixture-login", (req, res) => {
			Object.assign(req.session, {
				userId: "test-user",
				lastActivity: req.query.expired ? Date.now() - 2 * 60 * 60 * 1000 : Date.now()
			});
			mockSessions.set("test-user", req.sessionID);
			res.sendStatus(200);
		});
		app.use(lastActivityMiddleware);
		app.use(singleSessionMiddleware);
		app.use(libraryFilesMiddleware(directory, legacyPath));
		app.use(appStaticMiddleware(directory));
		app.get("/*", (_req, res) => res.send("SPA shell"));
		app.use((err: {status?: number}, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
			res.status(err.status ?? 500).end();
		});
		server = createServer(app);
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", resolve);
		});
		port = (server.address() as AddressInfo).port;
	});

	beforeEach(() => { mockSessions.clear(); mockDbUnavailable = false; });
	afterAll(async () => {
		if (server?.listening) await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
		store.clear();
		if (directory) await rm(directory, {recursive: true, force: true});
	});

	test.each([
		"/books/sample.pdf", "/cache/sample.pdf", "/covers/sample.pdf", "/temp_covers/sample.pdf",
		`${legacyPath}/sample.pdf`, "/books/sample.m4a", "/books/sample.epub",
		"/%62ooks/sample.pdf", "/books%2Fsample.pdf", "//books//sample.pdf",
		"/assets/../books/sample.pdf", "/assets/%2e%2e/books/sample.pdf",
		"/home/fixture/Libretorio-Scanner/dist/public/%62ooks/sample.pdf"
	])("denies anonymous access to %s, including encoded aliases", async url => {
		const response = await send(url, {headers: {Range: "bytes=0-0"}});
		expect(response.status).toBe(401);
		expect(response.headers.location).toBeUndefined();
		expect(response.headers["cache-control"]).toBe("private, no-store");
		expect(response.headers.vary).toContain("Cookie");
		expect(JSON.parse(response.body.toString()).code).toBe("UNAUTHENTICATED");
	});

	test.each(["/books/sample.pdf", "/books/sample.m4a", "/books/sample.epub", "/cache/sample.pdf", `${legacyPath}/sample.pdf`])(
		"preserves authenticated range requests for %s", async url => {
			const response = await send(url, {cookie: await login(), headers: {Range: "bytes=5-9"}});
			expect(response.status).toBe(206);
			expect(response.headers["content-range"]).toBe(`bytes 5-9/${bytes.length}`);
			expect(response.body).toEqual(bytes.subarray(5, 10));
			expect(response.headers["cache-control"]).toBe("private, no-store");
		}
	);

	test("keeps HEAD and conditional requests behind authentication", async () => {
		const cookie = await login();
		const full = await send("/books/sample.pdf", {cookie});
		expect(full.status).toBe(200);
		expect(full.body).toEqual(bytes);
		const head = await send("/books/sample.pdf", {cookie, method: "HEAD"});
		expect(head.status).toBe(200);
		expect(head.body.length).toBe(0);
		expect(head.headers["content-length"]).toBe(String(bytes.length));
		expect((await send("/books/sample.pdf", {method: "HEAD"})).status).toBe(401);
		expect((await send("/books/sample.pdf", {headers: {"If-None-Match": full.headers.etag!}})).status).toBe(401);
	});

	test("returns 404 for missing authenticated files, not the SPA", async () => {
		const response = await send("/books/missing.pdf", {cookie: await login()});
		expect(response.status).toBe(404);
		expect(response.headers["cache-control"]).toBe("private, no-store");
	});

	test("preserves invalid range handling", async () => {
		const response = await send("/books/sample.pdf", {cookie: await login(), headers: {Range: "bytes=9999-"}});
		expect(response.status).toBe(416);
		expect(response.headers["cache-control"]).toBe("private, no-store");
	});

	test("invalidates the first session when another device logs in", async () => {
		const first = await login();
		const second = await login();
		const invalidated = await send("/books/sample.pdf", {cookie: first});
		expect(invalidated.status).toBe(401);
		expect(invalidated.headers.location).toBeUndefined();
		expect(JSON.parse(invalidated.body.toString()).code).toBe("SESSION_INVALIDATED");
		expect((await send("/books/sample.pdf", {cookie: second})).status).toBe(200);
	});

	test("returns 401, not a login page, for an expired session", async () => {
		const response = await send("/books/sample.pdf", {cookie: await login(true)});
		expect(response.status).toBe(401);
		expect(response.headers.location).toBeUndefined();
		expect(JSON.parse(response.body.toString()).code).toBe("SESSION_EXPIRED");
	});

	test.each(["/main.js", "/assets/sample.pdf", "/bookshelf.js", "/auth/login"])("keeps application assets and login public: %s", async url => {
		expect((await send(url)).status).toBe(200);
	});

	test.each(["/", "/auth/login", "/parent/abc/id/def"])("preserves login navigation for expired app routes: %s", async url => {
		const response = await send(url, {cookie: await login(true), headers: {Accept: "text/html"}});
		expect(response.status).toBe(302);
		expect(response.headers.location).toBe("/auth/login");
	});

	test.each(["/books/sample.pdf", "/cache/sample.pdf", "/api/me", "/parent/../books/sample.pdf"])(
		"never redirects expired file/API requests even when HTML is accepted: %s", async url => {
			const response = await send(url, {cookie: await login(true), headers: {Accept: "text/html"}});
			expect(response.status).toBe(401);
			expect(response.headers.location).toBeUndefined();
		}
	);

	test("rejects malformed URI escapes", async () => {
		expect((await send("/books/%ZZ.pdf")).status).toBe(400);
	});

	test("does not destroy the session on a validation outage", async () => {
		const cookie = await login();
		mockDbUnavailable = true;
		const response = await send("/books/sample.pdf", {cookie});
		expect(response.status).toBe(503);
		expect(response.headers["cache-control"]).toBe("private, no-store");
		mockDbUnavailable = false;
		expect((await send("/books/sample.pdf", {cookie})).status).toBe(200);
	});

	test("requires authentication for a private symlink under assets", async () => {
		expect((await send("/assets/alias/sample.pdf")).status).toBe(401);
		expect((await send("/assets/alias/sample.pdf", {cookie: await login()})).body).toEqual(bytes);
	});

	test("denies symlink escapes from both private and public roots", async () => {
		expect((await send("/books/escape.txt", {cookie: await login()})).status).toBe(403);
		expect((await send("/assets/escape.txt")).status).toBe(403);
	});

	test.each(["/", "/index.html", "/main.js"])("revalidates app entry/non-fingerprinted asset %s", async url => {
		expect((await send(url)).headers["cache-control"]).toBe("no-cache");
	});

	test("preserves caching of fingerprinted bundles", async () => {
		expect((await send("/main-A123BCDE.js")).headers["cache-control"]).toContain("max-age=");
	});

	test("sandboxes active document formats without sandboxing the application", async () => {
		const cookie = await login();
		expect((await send("/books/sample.html", {cookie})).headers["content-security-policy"]).toBe("sandbox");
		expect((await send("/index.html", {cookie})).headers["content-security-policy"]).toBeUndefined();
	});
});

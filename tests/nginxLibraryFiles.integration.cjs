// Optional: node tests/nginxLibraryFiles.integration.cjs
// Requires a local Docker daemon and nginx:1.24-alpine. No production access.
require("ts-node/register/transpile-only");
const assert = require("node:assert/strict");
const {execFile, spawn} = require("node:child_process");
const {mkdtemp, mkdir, readFile, rm, symlink, writeFile} = require("node:fs/promises");
const {createServer} = require("node:http");
const {tmpdir} = require("node:os");
const path = require("node:path");
const {promisify} = require("node:util");
const express = require("express");
const {libraryFilesMiddleware} = require("../src/middlewares/libraryFilesMiddleware");

const exec = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const image = "nginx:1.24-alpine";
const name = `libretorio-nginx-test-${process.pid}-${Date.now()}`;

async function listen(server) {
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	return server.address().port;
}

async function main() {
	let directory;
	let backend;
	let child;
	let exited;
	let childFinished = false;
	let logs = "";
	try {
		await exec("docker", ["image", "inspect", image], {timeout: 10000});
		directory = await mkdtemp(path.join(tmpdir(), "libretorio-nginx-test-"));
		const publicDirectory = path.join(directory, "public");
		const legacy = "/home/rigo/Libretorio-Scanner/dist/public/books";
		for (const folder of ["books", "cache", "covers", "temp_covers"]) {
			await mkdir(path.join(publicDirectory, folder), {recursive: true});
			for (const extension of ["pdf", "m4a", "epub", "js"]) {
				await writeFile(path.join(publicDirectory, folder, `sample.${extension}`), "0123456789");
			}
		}
		await writeFile(path.join(publicDirectory, "main.js"), "public asset");
		await mkdir(path.dirname(path.join(publicDirectory, legacy)), {recursive: true});
		await symlink(path.join(publicDirectory, "books"), path.join(publicDirectory, legacy));

		const app = express();
		// Authentication is separately covered by the HTTP/session tests. This
		// loopback-only fixture isolates Nginx routing, cache policy and Range.
		app.use((req, _res, next) => {
			req.session = req.headers.cookie === "fixture=authenticated" ? {userId: "fixture"} : undefined;
			next();
		});
		app.use(libraryFilesMiddleware(publicDirectory, legacy));
		app.use(express.static(publicDirectory));
		app.use((err, _req, res, _next) => res.status(err.status || 500).end());
		backend = createServer(app);
		const backendPort = await listen(backend);
		const reservation = createServer();
		const proxyPort = await listen(reservation);
		await new Promise(resolve => reservation.close(resolve));

		const snippet = (await readFile(path.join(__dirname, "../deploy/nginx/library-files.conf"), "utf8"))
			.replace("http://10.10.0.2:3005", `http://127.0.0.1:${backendPort}`);
		await writeFile(path.join(directory, "library-files.conf"), snippet);
		await writeFile(path.join(directory, "nginx.conf"), `
pid /tmp/libretorio-nginx-test.pid;
error_log stderr;
events {}
http {
    access_log off;
    server {
        listen 127.0.0.1:${proxyPort};
        include /fixture/library-files.conf;
        location ~* \\.(?:js|css|pdf|webp)$ {
            proxy_pass http://127.0.0.1:${backendPort};
            expires 7d;
            add_header Cache-Control "public, max-age=604800" always;
        }
        location / { proxy_pass http://127.0.0.1:${backendPort}; }
    }
}
`);
		const common = ["run", "--rm", "--network", "host", "--mount", `type=bind,source=${directory},target=/fixture,readonly`, "--entrypoint", "nginx"];
		await exec("docker", [...common, image, "-t", "-c", "/fixture/nginx.conf"], {timeout: 20000});
		child = spawn("docker", [...common, "--name", name, image, "-c", "/fixture/nginx.conf", "-g", "daemon off;"], {stdio: ["ignore", "pipe", "pipe"]});
		exited = new Promise((resolve, reject) => {
			child.once("error", reject);
			child.once("close", code => { childFinished = true; resolve(code); });
		});
		child.stdout.on("data", chunk => logs += chunk);
		child.stderr.on("data", chunk => logs += chunk);

		const base = `http://127.0.0.1:${proxyPort}`;
		let ready = false;
		for (let attempt = 0; attempt < 100 && !childFinished; attempt++) {
			try {
				const response = await fetch(`${base}/main.js`, {signal: AbortSignal.timeout(500)});
				await response.arrayBuffer();
				if (response.status === 200) { ready = true; break; }
			} catch {}
			await sleep(100);
		}
		assert.ok(ready, `Nginx did not start: ${logs}`);

		let checks = 0;
		function privateResponse(response, status) {
			assert.equal(response.status, status);
			assert.equal(response.headers.get("cache-control"), "private, no-store");
			assert.equal(response.headers.get("expires"), null);
			checks++;
		}
		for (const url of ["/books/sample.pdf", "/books/sample.m4a", "/books/sample.epub", "/cache/sample.js", "/covers/sample.pdf", "/temp_covers/sample.pdf", `${legacy}/sample.pdf`, "/%62ooks/sample.pdf", "/books%2Fsample.pdf"]) {
			const response = await fetch(base + url, {headers: {Range: "bytes=0-0"}});
			privateResponse(response, 401);
			await response.arrayBuffer();
		}
		const head = await fetch(`${base}/books/sample.pdf`, {method: "HEAD"});
		privateResponse(head, 401);
		for (const extension of ["pdf", "m4a", "epub"]) {
			const response = await fetch(`${base}/books/sample.${extension}`, {
				headers: {Cookie: "fixture=authenticated", Range: "bytes=2-5"}
			});
			privateResponse(response, 206);
			assert.equal(response.headers.get("content-range"), "bytes 2-5/10");
			assert.equal(await response.text(), "2345");
		}
		const missing = await fetch(`${base}/books/missing.pdf`, {headers: {Cookie: "fixture=authenticated"}});
		privateResponse(missing, 404);
		await missing.arrayBuffer();
		const asset = await fetch(`${base}/main.js`);
		assert.equal(asset.status, 200);
		assert.ok(asset.headers.get("cache-control").includes("public"));
		await asset.arrayBuffer();
		console.log(`PASS: nginx -t; ${checks} protected response checks; public assets remain public.`);
	} finally {
		if (child) {
			await exec("docker", ["stop", "--time", "2", name], {timeout: 10000}).catch(() => {});
			if (!childFinished) child.kill("SIGTERM");
			await exited;
		}
		if (backend?.listening) await new Promise(resolve => backend.close(resolve));
		if (directory) await rm(directory, {recursive: true, force: true});
	}
}

main().catch(error => { console.error(error); process.exitCode = 1; });

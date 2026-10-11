import express, { RequestHandler } from "express";
import path from "path";
import { realpath } from "fs/promises";

export function libraryFilesMiddleware(publicDirectory: string, legacyBooksUrl: string): RequestHandler {
	const protectedPaths = ["/books", "/cache", "/covers", "/temp_covers", legacyBooksUrl];
	const serveFiles = express.static(publicDirectory, {cacheControl: false, fallthrough: false});
	const inside = (target: string, root: string) => target === root || target.startsWith(root + path.sep);

	return async (req, res, next) => {
		let pathname: string;
		try {
			// Match the decoded, normalized path used by the static file server.
			pathname = path.posix.normalize(decodeURIComponent(req.path));
		} catch {
			res.status(400).json({error: "Invalid URL."});
			return;
		}

		let namespace = protectedPaths.find(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
		let target: string | undefined;
		try {
			target = await realpath(path.join(publicDirectory, pathname));
			if (!namespace) {
				for (const prefix of protectedPaths) {
					const root = await realpath(path.join(publicDirectory, prefix)).catch((): string | undefined => undefined);
					if (root && inside(target, root)) {
						namespace = prefix;
						break;
					}
				}
			}
		} catch {
			// Authentication still precedes a protected missing-file response.
		}
		if (!namespace) return next();

		res.setHeader("Cache-Control", "private, no-store");
		res.vary("Cookie");
		if (/\.(?:html?|xhtml|svg|xml)$/i.test(pathname)) {
			// Library documents are not application code, even on our own origin.
			res.setHeader("Content-Security-Policy", "sandbox");
		}
		if (!req.session?.userId) {
			res.status(401).json({error: "Authentication required.", code: "UNAUTHENTICATED"});
			return;
		}
		if (target) {
			try {
				const root = await realpath(path.join(publicDirectory, namespace));
				if (!inside(target, root)) {
					res.status(403).json({error: "File is outside the library root."});
					return;
				}
			} catch (error) {
				next(error);
				return;
			}
		}

		serveFiles(req, res, next);
	};
}

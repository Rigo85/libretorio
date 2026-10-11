import express, { RequestHandler, Response } from "express";
import path from "path";
import { realpath } from "fs/promises";

export function appStaticMiddleware(directory: string): RequestHandler {
	const serve = express.static(directory, {
		maxAge: 31557600000,
		setHeaders: (res: Response, filePath: string) => {
			// Only fingerprinted bundles can retain a long-lived cache policy.
			if (!/[-.][a-z0-9]{8,}\.(?:js|mjs|css)$/i.test(path.basename(filePath))) {
				res.setHeader("Cache-Control", "no-cache");
			}
		}
	});
	return async (req, res, next) => {
		try {
			const [root, file] = await Promise.all([
				realpath(directory), realpath(path.join(directory, decodeURIComponent(req.path)))
			]);
			if (file !== root && !file.startsWith(root + path.sep)) {
				res.setHeader("Cache-Control", "private, no-store");
				res.sendStatus(403);
				return;
			}
		} catch {
			// The static server handles missing files and malformed URLs.
		}
		serve(req, res, next);
	};
}

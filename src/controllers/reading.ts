/* eslint-disable no-null/no-null -- Explicit nulls are part of this JSON API. */
import {Router, Request, Response, NextFunction} from "express";
import {rateLimit} from "express-rate-limit";
import {ReadingRepository, snapshot} from "(src)/repositories/ReadingRepository";
import {CacheArtifactStateRepository} from "(src)/repositories/CacheArtifactStateRepository";
import {ReadingError, ReadingSource, position, representation, fingerprint} from "(src)/services/ReadingSource";

const uuid = (value: unknown): boolean => typeof value === "string" && /^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
export function historyCursor(before: unknown, after: unknown): {at: string; id: string} | undefined {
	if (before === undefined && after === undefined) return undefined;
	if (before !== undefined && after !== undefined) throw new ReadingError(400, "INVALID_CURSOR");
	const encoded = before ?? after;
	if (typeof encoded !== "string" || encoded.length > 512 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new ReadingError(400, "INVALID_CURSOR");
	try {
		const cursor = JSON.parse(Buffer.from(encoded, "base64url").toString());
		if (!cursor || !uuid(cursor.id) || typeof cursor.at !== "string" || cursor.at.length > 64 ||
			!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:\d{2})?)$/.test(cursor.at) || !Number.isFinite(Date.parse(cursor.at))) throw new Error();
		if (new Date(cursor.at.slice(0, 10)).toISOString().slice(0, 10) !== cursor.at.slice(0, 10)) throw new Error();
		return {at: cursor.at, id: cursor.id};
	} catch {
		throw new ReadingError(400, "INVALID_CURSOR");
	}
}
function identifier(value: unknown): number {
	const id = Number(value); if (!Number.isSafeInteger(id) || id <= 0) throw new ReadingError(400, "INVALID_ID"); return id;
}
export function preferencePatch(body: any): any {
	if (!Number.isSafeInteger(body?.expectedRevision) || body.expectedRevision < 0 || !body.patch || typeof body.patch !== "object") throw new ReadingError(400, "INVALID_PREFERENCES");
	const rules: Record<string, Record<string, (v: any) => boolean>> = {
		pdf: {dark: v => typeof v === "boolean", fontSize: v => Number.isFinite(v) && v >= 12 && v <= 36,
			fontFamily: v => ["publisher", "serif", "sans-serif", "monospace"].includes(v), pageMargin: v => [6, 12, 24].includes(v), lineHeight: v => [1.3, 1.5, 1.8].includes(v)},
		epub: {fontSize: v => Number.isFinite(v) && v >= 50 && v <= 300},
		audio: {rate: v => Number.isFinite(v) && v >= 0.5 && v <= 2, continuous: v => typeof v === "boolean", repeat: v => typeof v === "boolean", remaining: v => typeof v === "boolean"}
	};
	const patch: any = {};
	for (const [group, fields] of Object.entries(body.patch)) {
		if (!Object.hasOwn(rules, group) || !fields || typeof fields !== "object") throw new ReadingError(400, "INVALID_PREFERENCES");
		patch[group] = {};
		for (const [key, value] of Object.entries(fields)) {
			if (!Object.hasOwn(rules[group], key) || !rules[group][key](value)) throw new ReadingError(400, "INVALID_PREFERENCES");
			patch[group][key] = value;
		}
	}
	return patch;
}
export function readingRouter(): Router {
	const router = Router(), repository = new ReadingRepository(), source = new ReadingSource();
	router.use((req, res, next) => {
		res.setHeader("Cache-Control", "private, no-store"); res.vary("Cookie");
		if (!req.session?.userId) {
			res.status(401).json({code: "UNAUTHENTICATED"}); return;
		} next();
	});
	router.use((req, res, next) => {
		if (req.path !== "/capabilities" && req.get("X-Reading-Session") !== fingerprint(req.sessionID)) {
			res.status(409).json({code: "READING_SESSION_CHANGED"}); return;
		} next();
	});
	router.use(rateLimit({windowMs: 60000, limit: 120, keyGenerator: req => req.session.userId, standardHeaders: true, legacyHeaders: false}));
	const handle = (fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response, next: NextFunction) => {
		try {
			await fn(req, res);
		} catch (error) {
			if (error instanceof ReadingError) res.status(error.status).json({code: error.code});
			else {
				console.error("Reading API failed", {code: error.code ?? "INTERNAL"}); res.status(503).json({code: "READING_UNAVAILABLE"});
			}
		}
	};
	const identity = (req: Request) => ({userId: req.session.userId, sessionId: req.sessionID});
	router.get("/capabilities", (req, res) => {
		res.json({version: 1, userId: req.session.userId, epoch: fingerprint(req.sessionID)});
	});
	router.get("/preferences", handle(async (req, res) => {
		res.json(await repository.preferences(req.session.userId));
	}));
	router.patch("/preferences", handle(async (req, res) => {
		const patch = preferencePatch(req.body); res.json(await repository.savePreferences(identity(req), req.body.expectedRevision, patch));
	}));
	router.get("/history", handle(async (req, res) => {
		const mode = req.query.mode === "continue" ? "continue" : "recent", filter = req.query.format ? representation(req.query.format) : "";
		const kind = req.query.kind ?? "";
		if (typeof kind !== "string" || !["", "FILE", "EPUB", "AUDIOBOOK", "COMIC-MANGA", "NONE"].includes(kind)) throw new ReadingError(400, "INVALID_MATERIAL_KIND");
		const cursor = historyCursor(req.query.before, req.query.after), after = req.query.after !== undefined;
		const found = await repository.list(req.session.userId, mode, filter, cursor, kind, after), more = found.length > 20;
		const rows = found.slice(0, 20); if (after) rows.reverse();
		const edge = (row: any) => ({at: row.cursor_at as string, id: row.id as string});
		const encode = (value: {at: string; id: string}) => Buffer.from(JSON.stringify(value)).toString("base64url");
		const first = rows[0], last = rows[rows.length - 1];
		const newer = after ? more : !!first && !!cursor && await repository.hasHistory(req.session.userId, mode, filter, edge(first), kind, true);
		const older = after ? !!last && await repository.hasHistory(req.session.userId, mode, filter, edge(last), kind, false) : more;
		const items = [];
		for (const row of rows) {
			let availability = row.live_id ? "available" : "missing";
			if (row.live_id && (row.live_item.name !== row.snapshot.name || row.live_item.parentPath !== row.snapshot.parentPath)) availability = "missing";
			if (availability === "available") {
				try {
					await source.resolve(row.live_item);
				} catch (error) {
					if (!(error instanceof ReadingError)) throw error; availability = "unavailable";
				}
			}
			items.push({id: row.id, archiveId: row.original_archive_id, snapshot: availability === "available" ? snapshot(row.live_item) : row.snapshot,
				lastVisitedAt: row.last_visited_at, visits: row.visits, progress: row.progress, availability});
		}
		res.json({items, next: older ? encode(edge(last)) : null, previous: newer ? encode(edge(first)) : null, paginationVersion: 2});
	}));
	router.get("/items/:id", handle(async (req, res) => {
		const item = await source.item(identifier(req.params.id)); await source.resolve(item);
		if (item.fileKind === "COMIC-MANGA" || (item.fileKind === "FILE" && /\.(cbr|cbz|cb7|cbt)$/i.test(item.name))) {
			item.comicReaderReady = await CacheArtifactStateRepository.getInstance().isReaderReady(item.coverId);
		}
		res.json(item);
	}));
	router.post("/items/:id/visit", handle(async (req, res) => {
		if (!uuid(req.body?.operationId)) throw new ReadingError(400, "INVALID_OPERATION");
		const item = await source.item(identifier(req.params.id));
		const history = await repository.visit(identity(req), item, req.body.operationId); res.json({id: history.id, snapshot: snapshot(item)});
	}));
	router.get("/items/:id/progress/:representation", handle(async (req, res) => {
		const id = identifier(req.params.id), rep = representation(req.params.representation), item = await source.item(id);
		const saved = await repository.progress(req.session.userId, id, rep);
		const locator = req.query.fresh === "1" ? undefined : req.query.track ? {track: req.query.track} : req.query.section ? {section: req.query.section} : saved?.position;
		const current = await source.resolve(item, rep, locator);
		res.json({sourceRevision: current.revision, sourcePath: current.path, saved: saved ?? null,
			changed: !!saved && !req.query.track && !req.query.section && saved.source_revision !== current.revision});
	}));
	router.put("/items/:id/progress/:representation", handle(async (req, res) => {
		const rep = representation(req.params.representation), body = req.body;
		if (!uuid(body?.operationId) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 ||
			typeof body.sourceRevision !== "string" || !/^[a-f\d]{64}$/.test(body.sourceRevision)) throw new ReadingError(400, "INVALID_PROGRESS");
		const located = position(rep, body.position), item = await source.item(identifier(req.params.id));
		const current = await source.resolve(item, rep, located);
		if (current.revision !== body.sourceRevision) throw new ReadingError(409, "SOURCE_CHANGED");
		res.json(await repository.save(identity(req), item, rep, {...body, position: located}));
	}));
	router.use((_req, res) => {
		res.status(404).json({code: "READING_ROUTE_NOT_FOUND"});
	});
	return router;
}

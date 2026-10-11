/* eslint-disable no-null/no-null -- Explicit null cursors are part of this JSON API. */
import {Router} from "express";
import {PoolClient} from "pg";
import {rateLimit} from "express-rate-limit";
import {PostgresAdapter} from "(src)/db/PostgresAdapter";
import {decodeCursor, encodeCursor, filters, searchQuery, SearchError} from "(src)/services/CatalogueSearch";

export function catalogueSearchRouter(): Router {
	const router = Router(); let active = 0; const users = new Set<string>();
	router.use((req, res, next)=>{
		res.setHeader("Cache-Control", "private, no-store"); res.vary("Cookie");
		if (!req.session?.userId){
			res.status(401).json({code:"UNAUTHENTICATED"}); return;
		}next();
	});
	router.use(rateLimit({windowMs:60000, limit:30, keyGenerator:req=>req.session.userId, standardHeaders:true, legacyHeaders:false}));
	router.get("/", async(req, res)=>{
		let acquired = false, client: PoolClient, waiting = false, expired = false;
		const user = req.session.userId;
		const releaseSlot = ()=>{
			if (acquired){
				acquired = false; active--; users.delete(user);
			}
		};
		try {
			const filter = filters(req.query), previous = req.query.before !== undefined;
			if (previous && req.query.after !== undefined) throw new SearchError(400, "INVALID_CURSOR");
			const cursor = decodeCursor(req.query.before ?? req.query.after, filter);
			if (active >= 2 || users.has(user)) throw new SearchError(429, "SEARCH_BUSY");
			acquired = true; active++; users.add(user);
			waiting = true;
			client = await new Promise<PoolClient>((resolve, reject)=>{
				const timer = setTimeout(()=>{
					expired = true; reject(new SearchError(503, "SEARCH_BUSY"));
				}, 1500);
				PostgresAdapter.getInstance().pool.connect().then(value=>{
					waiting = false; clearTimeout(timer);
					if (expired){
						value.release(); releaseSlot();
					} else resolve(value);
				}, error=>{
					waiting = false; clearTimeout(timer); if (expired)releaseSlot(); else reject(error);
				});
			});
			if (res.destroyed) return;
			await client.query("BEGIN READ ONLY");
			await client.query("SET LOCAL statement_timeout='5s'; SET LOCAL work_mem='4MB'; SET LOCAL max_parallel_workers_per_gather=0; SET LOCAL idle_in_transaction_session_timeout='10s'");
			const query = searchQuery(filter, cursor, previous), started = Date.now();
			const {rows} = await client.query(query.text, query.values);
			await client.query("COMMIT");
			const more = rows.length > 50, items = rows.slice(0, 50); if (previous)items.reverse();
			const first = items[0], last = items[items.length - 1];
			if (!res.destroyed)res.json({version:1, items:items.map(({key, ...row})=>row),
				next:last && (previous ? !!cursor : more) ? encodeCursor(last, filter) : null,
				previous:first && (previous ? more : !!cursor) ? encodeCursor(first, filter) : null, elapsedMs:Date.now() - started});
		} catch(error){
			if (client) try {
				await client.query("ROLLBACK");
			} catch {}
			if (!res.destroyed){
				const code = error instanceof SearchError ? error.code : error.code === "57014" ? "SEARCH_TIMEOUT" : "SEARCH_UNAVAILABLE";
				res.status(error instanceof SearchError ? error.status : 503).json({code});
			}
		} finally {
			client?.release(); if (!waiting)releaseSlot();
		}
	});
	return router;
}

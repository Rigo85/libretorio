import type { Request } from "express";

// Normalise ::ffff:127.0.0.1 → 127.0.0.1
const stripIpv6Prefix = (ip = "") =>
	ip.startsWith("::ffff:") ? ip.slice(7) : ip;

export function getClientIp(req: Request): string {
	const hdr = req.headers;

	// 1. CDN- or edge-specific single-value headers
	const ip =
		(hdr["cf-connecting-ip"] as string) || // Cloudflare
		(hdr["x-real-ip"] as string) ||        // Nginx/FastCGI
		// 2. First address in X-Forwarded-For (may be array or CSV)
		(Array.isArray(hdr["x-forwarded-for"])
			? hdr["x-forwarded-for"][0]
			: hdr["x-forwarded-for"]?.split(",")[0]) ||
		// 3. Express-parsed value (requires trust proxy)
		req.ip ||
		// 4. Node socket fallback
		req.socket?.remoteAddress ||
		"";

	return stripIpv6Prefix(ip.trim());
}

// export function getIpAddress(req: any): string {
// 	// Check if the request has a headers property
// 	if (req && req.headers) {
// 		// Try to get the IP address from the 'x-forwarded-for' header
// 		const forwardedFor = req.headers["x-forwarded-for"];
// 		if (forwardedFor) {
// 			// If there are multiple IPs, take the first one
// 			return Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor.split(",")[0].trim();
// 		}
//
// 		// Fallback to 'remoteAddress' if 'x-forwarded-for' is not present
// 		return req.connection?.remoteAddress || req.socket?.remoteAddress || "";
// 	}
//
// 	// Return an empty string if no IP address can be determined
// 	return "";
//
//
// 	// Intenta obtener la IP desde varios encabezados comunes
// 	// const xForwardedFor = req.get("X-Forwarded-For")?.split(",")[0]?.trim();
// 	// const xRealIp = req.get("X-Real-IP");
// 	//
// 	// return xForwardedFor || xRealIp || req.ip || "unknown";
// }
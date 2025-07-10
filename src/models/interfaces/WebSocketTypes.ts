import { WebSocket } from "ws";
import http from "http";

export interface SessionData {
	userId: string;
	isAdmin: boolean;
	lastActivity?: number;
}

export interface ExtendedWebSocket extends WebSocket {
	isAlive: boolean;
	session: SessionData;
}

export interface WSServerConfig {
	pingInterval?: number;
	upgradeTimeout?: number;
	shutdownTimeout?: number;
}

export interface SessionRequest extends http.IncomingMessage {
	session?: SessionData;
}

export type WebsocketAction =
	"ls" |
	"search" |
	"search_text" |
	"update" |
	"decompress" |
	"convert_to_pdf" |
	"get_more_pages" |
	"get_audio_book" |
	"log_action" |
	"default"
	;

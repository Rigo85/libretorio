import {EventEmitter} from "node:events";

// Only internal listeners; never send session identifiers in client events or logs.
export const sessionRevocations = new EventEmitter();

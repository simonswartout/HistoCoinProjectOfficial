import { stdout } from "node:process";
const LEVEL_ORDER = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
};
const MIN_LEVEL = process.env.LOG_LEVEL?.toLowerCase();
const MIN_LEVEL_VALUE = MIN_LEVEL ? LEVEL_ORDER[MIN_LEVEL] ?? 2 : 2;
export function log(level, message, meta) {
    if (LEVEL_ORDER[level] > MIN_LEVEL_VALUE) {
        return;
    }
    const payload = {
        level,
        message,
        time: new Date().toISOString(),
        ...meta,
    };
    stdout.write(`${JSON.stringify(payload)}\n`);
}
export const logger = {
    info: (message, meta) => log("info", message, meta),
    warn: (message, meta) => log("warn", message, meta),
    error: (message, meta) => log("error", message, meta),
    debug: (message, meta) => log("debug", message, meta),
};

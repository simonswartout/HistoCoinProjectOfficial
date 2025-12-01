import { stdout } from "node:process";

type Level = "info" | "warn" | "error" | "debug";

const LEVEL_ORDER: Record<Level, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const MIN_LEVEL = process.env.LOG_LEVEL?.toLowerCase() as Level | undefined;
const MIN_LEVEL_VALUE = MIN_LEVEL ? LEVEL_ORDER[MIN_LEVEL] ?? 2 : 2;

export function log(level: Level, message: string, meta?: Record<string, unknown>) {
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
  info: (message: string, meta?: Record<string, unknown>) => log("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log("error", message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => log("debug", message, meta),
};

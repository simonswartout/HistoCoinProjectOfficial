import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { logger } from "./logger.js";
const SourceSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    baseUrl: z.string().url(),
    type: z.enum(["generic", "met_api"]).optional().default("generic"),
    notes: z.string().optional(),
    priority: z.number().optional(),
});
const ConfigSchema = z.object({
    sources: z.array(SourceSchema).min(1),
});
export async function loadConfigFromFile(path) {
    const absPath = resolve(path);
    const raw = await readFile(absPath, "utf8");
    const json = JSON.parse(raw);
    const parsed = ConfigSchema.parse(json);
    return parsed;
}
export async function loadSourcesFromMaster(masterUrl) {
    const url = new URL("/sources", masterUrl);
    const response = await fetch(url, {
        headers: { Accept: "application/json" },
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch sources from master (${response.status})`);
    }
    const data = (await response.json());
    const normalized = data.map((item) => ({
        id: String(item.id ?? item.base_url ?? randomUUID()),
        name: item.name ?? item.base_url ?? item.baseUrl ?? "Unknown Source",
        baseUrl: item.base_url ?? item.baseUrl ?? "",
        type: "generic",
    }));
    const final = normalized.filter((s) => s.baseUrl);
    if (!final.length) {
        logger.warn("No sources returned by master. Provide a local config or seed the database.");
    }
    return final;
}

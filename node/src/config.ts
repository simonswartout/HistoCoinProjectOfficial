import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { MiningSource, NodeConfig } from "./types.js";
import { logger } from "./logger.js";

const CollectionSchema = z
  .object({
    listingUrls: z.array(z.string().url()).optional(),
    searchUrlTemplate: z.string().url().optional(),
    searchTerms: z.array(z.string().min(1)).optional(),
    resultItemSelector: z.string().min(1),
    linkAttribute: z.string().optional(),
    maxItems: z.number().int().positive().optional(),
  })
  .refine(
    (value) => {
      const hasListings = Array.isArray(value.listingUrls) && value.listingUrls.length > 0;
      const hasSearchTemplate = Boolean(value.searchUrlTemplate && value.searchTerms?.length);
      return hasListings || hasSearchTemplate;
    },
    {
      message: "collection must define listingUrls or a searchUrlTemplate with searchTerms",
    }
  );

const SourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string().url(),
  type: z.enum(["generic", "met_api"]).optional().default("generic"),
  notes: z.string().optional(),
  priority: z.number().optional(),
  collection: CollectionSchema.optional(),
});

const ConfigSchema = z.object({
  sources: z.array(SourceSchema).min(1),
});

export async function loadConfigFromFile(path: string): Promise<NodeConfig> {
  const absPath = resolve(path);
  const raw = await readFile(absPath, "utf8");
  const json = JSON.parse(raw);
  const parsed = ConfigSchema.parse(json);
  return parsed;
}

export async function loadSourcesFromMaster(masterUrl: string): Promise<MiningSource[]> {
  const url = new URL("/sources", masterUrl);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch sources from master (${response.status})`);
  }
  const data = (await response.json()) as Array<{ id?: number; name?: string; base_url?: string; baseUrl?: string }>;
  const normalized: MiningSource[] = data.map((item) => ({
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

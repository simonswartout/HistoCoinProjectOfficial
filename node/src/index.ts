#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { Command } from "commander";
import { loadConfigFromFile, loadSourcesFromMaster } from "./config.js";
import { MasterClient } from "./masterClient.js";
import { scrapeSource } from "./scraper.js";
import { logger } from "./logger.js";
import { sleep } from "./utils.js";
import type { MiningSource } from "./types.js";

interface RunOptions {
  masterUrl: string;
  nodeId: string;
  token?: string;
  sourcesPath?: string;
  fetchRemoteSources?: boolean;
  loop?: boolean;
  intervalSeconds: number;
  cooldownSeconds: number;
  dryRun?: boolean;
  maxSources?: number;
}

const DEFAULT_INTERVAL = 30;
const DEFAULT_COOLDOWN = 5;

async function main() {
  const program = new Command();
  program.name("histocoin-node").description("Headless miner for the HistoCoin master server").version("0.1.0");

  program
    .command("run")
    .option("--master-url <url>", "Master server URL", process.env.MASTER_URL ?? "http://localhost:8000")
    .option("--node-id <id>", "Node identifier (defaults to NODE_ID env or random UUID)", process.env.NODE_ID)
    .option("--token <token>", "Bearer token issued by master", process.env.NODE_TOKEN)
    .option("--sources <path>", "Path to sources JSON file", "config/sources.json")
    .option("--fetch-remote-sources", "Pull sources from master /sources endpoint", false)
    .option("--loop", "Run continuously", false)
    .option("--interval <seconds>", "Seconds to wait between loops", `${DEFAULT_INTERVAL}`)
    .option("--cooldown <seconds>", "Seconds to wait between sources", `${DEFAULT_COOLDOWN}`)
    .option("--dry-run", "Print payloads without POSTing", false)
    .option("--max-sources <number>", "Limit number of sources per loop", undefined)
    .action(async (rawOpts) => {
      const runOpts: RunOptions = {
        masterUrl: rawOpts.masterUrl,
        nodeId: rawOpts.nodeId ?? randomUUID(),
        token: rawOpts.token,
        sourcesPath: rawOpts.sources,
        fetchRemoteSources: Boolean(rawOpts.fetchRemoteSources),
        loop: Boolean(rawOpts.loop),
        intervalSeconds: Number(rawOpts.interval ?? DEFAULT_INTERVAL),
        cooldownSeconds: Number(rawOpts.cooldown ?? DEFAULT_COOLDOWN),
        dryRun: Boolean(rawOpts.dryRun),
        maxSources: rawOpts.maxSources ? Number(rawOpts.maxSources) : undefined,
      };

      await runNode(runOpts);
    });

  await program.parseAsync(process.argv);
}

async function runNode(options: RunOptions) {
  logger.info("Node starting", { masterUrl: options.masterUrl, nodeId: options.nodeId });
  const client = new MasterClient({ baseUrl: options.masterUrl, nodeId: options.nodeId, token: options.token });

  let keepRunning = true;
  process.on("SIGINT", () => {
    logger.warn("Received SIGINT, shutting down after current iteration");
    keepRunning = false;
  });

  do {
    const sources = await resolveSources(options);
    if (!sources.length) {
      logger.warn("No sources available; sleeping before retry", { interval: options.intervalSeconds });
      await sleep(options.intervalSeconds * 1000);
      continue;
    }
    await processSources(sources, client, options);
    if (!options.loop) {
      break;
    }
    if (!keepRunning) {
      break;
    }
    logger.info("Loop complete", { sleepSeconds: options.intervalSeconds });
    await sleep(options.intervalSeconds * 1000);
  } while (keepRunning);

  logger.info("Node stopped");
}

async function resolveSources(options: RunOptions): Promise<MiningSource[]> {
  if (options.fetchRemoteSources) {
    return loadSourcesFromMaster(options.masterUrl);
  }
  if (!options.sourcesPath) {
    logger.warn("No sources path provided; falling back to remote /sources endpoint");
    return loadSourcesFromMaster(options.masterUrl);
  }
  try {
    const config = await loadConfigFromFile(options.sourcesPath);
    return config.sources;
  } catch (error) {
    logger.error("Failed to load sources file, falling back to master", {
      path: options.sourcesPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return loadSourcesFromMaster(options.masterUrl);
  }
}

async function processSources(
  sources: MiningSource[],
  client: MasterClient,
  options: RunOptions
): Promise<void> {
  const slice = typeof options.maxSources === "number" ? sources.slice(0, options.maxSources) : sources;
  for (const source of slice) {
    logger.info("Scraping source", { source: source.id, url: source.baseUrl });
    const artifact = await scrapeSource(source);
    if (!artifact) {
      await maybeCooldown(options);
      continue;
    }
    if (!artifact.cc0.isLikelyCc0) {
      logger.info("Skipping non-CC0 candidate", {
        source: source.id,
        confidence: artifact.cc0.confidence,
        evidence: artifact.cc0.evidence,
      });
      await maybeCooldown(options);
      continue;
    }
    if (options.dryRun) {
      logger.info("Dry run payload", { artifact });
    } else {
      try {
        await client.submit(artifact);
      } catch (error) {
        logger.error("Failed to submit artifact", {
          source: source.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await maybeCooldown(options);
  }
}

async function maybeCooldown(options: RunOptions) {
  if (options.cooldownSeconds > 0) {
    await sleep(options.cooldownSeconds * 1000);
  }
}

main().catch((error) => {
  logger.error("Fatal error", { error: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});

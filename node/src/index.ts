#!/usr/bin/env node
import process from "node:process";
import { randomUUID } from "node:crypto";
import { Command } from "commander";
import { loadConfigFromFile, loadSourcesFromMaster } from "./config.js";
import { MasterClient } from "./masterClient.js";
import { scrapeSource } from "./scraper.js";
import { logger } from "./logger.js";
import { sleep } from "./utils.js";
import type { MiningSource } from "./types.js";
import { addSourceToIndex, appendArtifactToIndex, loadSourcesFromIndex } from "./sourceIndex.js";
import { classifyArtifactWithLlama } from "./llama.js";

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
  globalIndexPath: string;
  randomFromGlobal?: boolean;
  targetUrl?: string;
  targetName?: string;
  appendArtifactsToIndex: boolean;
  llamaEnabled: boolean;
  llamaModel: string;
  llamaEndpoint: string;
}

const DEFAULT_INTERVAL = 30;
const DEFAULT_COOLDOWN = 5;
const DEFAULT_GLOBAL_INDEX = "config/global-sources.json";

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
    .option("--global-index <path>", "Path to the shared global source index", DEFAULT_GLOBAL_INDEX)
    .option("--random-global", "Pick a random source from the global index", false)
    .option("--target-url <url>", "Scrape a single URL; auto-adds it to the global index")
    .option("--target-name <name>", "Friendly name for --target-url (optional)")
    .option("--no-append-artifacts", "Do not copy discovered artifact URLs into the global index")
    .option("--llama-model <name>", "Meta Llama 3 model id (via Ollama or compatible endpoint)", process.env.LLAMA_MODEL ?? "llama3")
    .option("--llama-endpoint <url>", "Endpoint for llama text generation", process.env.LLAMA_ENDPOINT ?? "http://localhost:11434/api/generate")
    .option("--disable-llama", "Skip llama-based validation", false)
    .action(async (rawOpts: any) => {
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
        globalIndexPath: rawOpts.globalIndex ?? DEFAULT_GLOBAL_INDEX,
        randomFromGlobal: Boolean(rawOpts.randomGlobal),
        targetUrl: rawOpts.targetUrl,
        targetName: rawOpts.targetName,
        appendArtifactsToIndex: rawOpts.appendArtifacts !== false,
        llamaEnabled: !rawOpts.disableLlama,
        llamaModel: rawOpts.llamaModel,
        llamaEndpoint: rawOpts.llamaEndpoint,
      };

      await runNode(runOpts);
    });

  program
    .command("add-source")
    .argument("<url>", "URL to add to the global index")
    .option("--name <name>", "Friendly name", undefined)
    .option("--type <type>", "Source type (generic, met_api, etc.)", "generic")
    .option("--notes <text>", "Optional notes about the source")
    .option("--index <path>", "Path to the global index JSON", DEFAULT_GLOBAL_INDEX)
    .action(async (url: string, opts: any) => {
      try {
        const result = await addSourceToIndex({
          indexPath: opts.index ?? DEFAULT_GLOBAL_INDEX,
          url,
          name: opts.name,
          type: opts.type,
          notes: opts.notes,
        });
        if (result.added) {
          logger.info("Source added to global index", { id: result.source.id, url: result.source.baseUrl });
        } else {
          logger.info("Source already existed", { id: result.source.id, url: result.source.baseUrl });
        }
      } catch (error) {
        logger.error("Failed to add source", { error: error instanceof Error ? error.message : String(error) });
        process.exitCode = 1;
      }
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
  if (options.targetUrl) {
    const result = await addSourceToIndex({
      indexPath: options.globalIndexPath,
      url: options.targetUrl,
      name: options.targetName,
    });
    logger.info("Target URL ready", { url: options.targetUrl, added: result.added });
    return [result.source];
  }

  if (options.randomFromGlobal) {
    const globalSources = await loadSourcesFromIndex(options.globalIndexPath);
    if (!globalSources.length) {
      logger.warn("Global index is empty; add sources before using --random-global", {
        index: options.globalIndexPath,
      });
      return [];
    }
    const picked = globalSources[Math.floor(Math.random() * globalSources.length)];
    logger.info("Random global source selected", { id: picked.id, url: picked.baseUrl });
    return [picked];
  }

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
    const artifacts = await scrapeSource(source);
    if (!artifacts.length) {
      await maybeCooldown(options);
      continue;
    }
    for (const artifact of artifacts) {
      if (!artifact.cc0.isLikelyCc0) {
        logger.info("Skipping non-CC0 candidate", {
          source: source.id,
          confidence: artifact.cc0.confidence,
          evidence: artifact.cc0.evidence,
          url: artifact.url,
        });
        continue;
      }

      if (options.llamaEnabled) {
        const llamaVerdict = await classifyArtifactWithLlama(
          artifact.title,
          artifact.summary,
          artifact.rawTextSnippet,
          {
            endpoint: options.llamaEndpoint,
            model: options.llamaModel,
          }
        );
        if (llamaVerdict) {
          artifact.llamaAssessment = llamaVerdict;
          artifact.metadata = {
            ...artifact.metadata,
            llamaAssessment: llamaVerdict,
          };
          if (llamaVerdict.verdict === "reject") {
            logger.info("Llama rejected artifact", {
              source: source.id,
              url: artifact.url,
              reason: llamaVerdict.reason,
              confidence: llamaVerdict.confidence,
            });
            continue;
          }
        }
      }

      if (options.dryRun) {
        logger.info("Dry run payload", { artifact });
      } else {
        try {
          await client.submit(artifact);
        } catch (error) {
          logger.error("Failed to submit artifact", {
            source: source.id,
            artifactUrl: artifact.url,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (options.appendArtifactsToIndex) {
        try {
          const result = await appendArtifactToIndex({
            indexPath: options.globalIndexPath,
            artifactUrl: artifact.url,
            artifactTitle: artifact.title,
            sourceName: artifact.sourceName,
          });
          if (result.added) {
            logger.info("Artifact URL stored in global index", { url: artifact.url });
          }
        } catch (error) {
          logger.warn("Failed to append artifact to global index", {
            url: artifact.url,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      await maybeCooldown(options);
    }
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

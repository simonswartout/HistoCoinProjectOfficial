import { load } from "cheerio";
import type { MiningSource, ScrapedArtifact } from "./types.js";
import { assessCc0 } from "./cc0.js";
import { logger } from "./logger.js";

export interface ScrapeOptions {
  timeoutMs?: number;
  userAgent?: string;
}

const DEFAULT_TIMEOUT = 20000;
const DEFAULT_USER_AGENT =
  "HistoCoinNode/0.1 (+https://github.com/simonswartout/HistoCoinProjectOfficial)";

export async function scrapeSource(
  source: MiningSource,
  options: ScrapeOptions = {}
): Promise<ScrapedArtifact | null> {
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(source.baseUrl, {
      headers: {
        "User-Agent": options.userAgent ?? DEFAULT_USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      logger.warn("Source fetch failed", { source: source.id, status: response.status });
      return null;
    }
    const html = await response.text();
    return parseHtml(source, html);
  } catch (error) {
    logger.error("Source fetch error", {
      source: source.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseHtml(source: MiningSource, html: string): ScrapedArtifact {
  const $ = load(html);
  $("script, style, noscript, nav, footer").remove();
  const title = ($("title").first().text() || source.name).trim();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const snippet = text.slice(0, 2000);

  const descriptionMeta = $('meta[name="description"]').attr("content") || "";
  const ogTitle = $('meta[property="og:title"]').attr("content") || "";
  const ogDesc = $('meta[property="og:description"]').attr("content") || "";
  const imageCandidate =
    $('meta[property="og:image"]').attr("content") ||
    $("img").first().attr("src") ||
    undefined;
  const image = imageCandidate ? resolveUrl(source.baseUrl, imageCandidate) : undefined;

  const metadata = {
    titleCandidates: [title, ogTitle].filter(Boolean),
    descriptionCandidates: [descriptionMeta, ogDesc].filter(Boolean),
    sourceNotes: source.notes,
  };

  const cc0 = assessCc0(`${snippet} ${descriptionMeta} ${ogDesc}`);

  const summary = ogDesc || descriptionMeta || snippet.slice(0, 360);

  return {
    sourceId: source.id,
    sourceName: source.name,
    url: source.baseUrl,
    title: title || ogTitle || source.name,
    summary,
    imageUrl: image,
    cc0,
    metadata,
    rawTextSnippet: snippet,
    scrapedAt: new Date().toISOString(),
  };
}

function resolveUrl(base: string, maybeRelative: string): string {
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return maybeRelative;
  }
}

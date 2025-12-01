import { load } from "cheerio";
import type { CollectionTraversal, MiningSource, ScrapedArtifact } from "./types.js";
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
): Promise<ScrapedArtifact[]> {
  if (source.collection) {
    return scrapeCollectionSource(source, options);
  }
  const html = await fetchHtml(source.baseUrl, options, source.id);
  if (!html) {
    return [];
  }
  const artifact = parseHtml(source, source.baseUrl, html);
  return artifact ? [artifact] : [];
}

async function scrapeCollectionSource(
  source: MiningSource,
  options: ScrapeOptions
): Promise<ScrapedArtifact[]> {
  const traversal = source.collection as CollectionTraversal;
  const listingUrls = buildListingUrls(traversal, source.baseUrl);
  if (!listingUrls.length) {
    logger.warn("Collection source missing listing URLs", { source: source.id });
    return [];
  }

  const detailLinks: Array<{ url: string; listing: string }> = [];
  for (const listingUrl of listingUrls) {
    const html = await fetchHtml(listingUrl, options, source.id);
    if (!html) {
      continue;
    }
    const $ = load(html);
    const selector = traversal.resultItemSelector;
    const attribute = traversal.linkAttribute || "href";
    $(selector).each((index: number, element: any) => {
      if (detailLinks.length >= (traversal.maxItems ?? 8)) {
        return false;
      }
      const raw = $(element).attr(attribute);
      if (!raw) {
        return;
      }
      try {
        const absolute = resolveUrl(listingUrl, raw);
        if (!detailLinks.some((entry) => entry.url === absolute)) {
          detailLinks.push({ url: absolute, listing: listingUrl });
        }
      } catch {
        /* ignore bad urls */
      }
    });
    if (detailLinks.length >= (traversal.maxItems ?? 8)) {
      break;
    }
  }

  if (!detailLinks.length) {
    logger.warn("Collection listing produced no detail URLs", { source: source.id });
    return [];
  }

  const artifacts: ScrapedArtifact[] = [];
  for (const link of detailLinks) {
    const html = await fetchHtml(link.url, options, source.id);
    if (!html) {
      continue;
    }
    const artifact = parseHtml(source, link.url, html, { listingUrl: link.listing });
    if (artifact) {
      artifacts.push(artifact);
    }
  }
  return artifacts;
}

function buildListingUrls(traversal: CollectionTraversal, fallbackBase: string): string[] {
  const urls: string[] = [];
  if (Array.isArray(traversal.listingUrls)) {
    urls.push(...traversal.listingUrls);
  }
  if (traversal.searchUrlTemplate && traversal.searchTerms?.length) {
    for (const term of traversal.searchTerms) {
      const encoded = encodeURIComponent(term.trim());
      urls.push(traversal.searchUrlTemplate.replace("{query}", encoded));
    }
  }
  if (!urls.length) {
    urls.push(fallbackBase);
  }
  return urls;
}

async function fetchHtml(url: string, options: ScrapeOptions, sourceId: string): Promise<string | null> {
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": options.userAgent ?? DEFAULT_USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      logger.warn("Source fetch failed", { source: sourceId, status: response.status, url });
      return null;
    }
    return await response.text();
  } catch (error) {
    logger.error("Source fetch error", {
      source: sourceId,
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseHtml(
  source: MiningSource,
  targetUrl: string,
  html: string,
  extraMetadata: Record<string, unknown> = {}
): ScrapedArtifact | null {
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
  const image = imageCandidate ? resolveUrl(targetUrl, imageCandidate) : undefined;

  const metadata = {
    titleCandidates: [title, ogTitle].filter(Boolean),
    descriptionCandidates: [descriptionMeta, ogDesc].filter(Boolean),
    sourceNotes: source.notes,
    ...extraMetadata,
  };

  const cc0 = assessCc0(`${snippet} ${descriptionMeta} ${ogDesc}`);

  const summary = ogDesc || descriptionMeta || snippet.slice(0, 360);

  return {
    sourceId: source.id,
    sourceName: source.name,
    url: targetUrl,
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

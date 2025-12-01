import { logger } from "./logger.js";
import type { MiningSource, ScrapedArtifact } from "./types.js";

interface AtlasClientConfig {
  baseUrl?: string;
  apiKey?: string;
  enabled?: boolean;
  timeoutMs?: number;
}

interface SourcePayload {
  id?: string;
  name: string;
  baseUrl: string;
  region?: string;
  type?: string;
  notes?: string;
  status?: string;
  artifactCount?: number;
  lat?: number;
  lng?: number;
}

interface ArtifactPayload {
  id?: string;
  title: string;
  url: string;
  summary?: string;
  caption?: string;
  year?: number;
  region?: string;
  sourceName?: string;
  sourceId?: string;
  lat?: number;
  lng?: number;
  discoveredBy?: string;
}

export class AtlasClient {
  private readonly baseUrl?: URL;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private enabled: boolean;

  constructor(config: AtlasClientConfig) {
    this.apiKey = config.apiKey?.trim();
    this.timeoutMs = config.timeoutMs ?? 8000;
    this.enabled = Boolean(config.enabled !== false && config.baseUrl && this.apiKey);
    if (config.baseUrl) {
      try {
        this.baseUrl = new URL(config.baseUrl);
      } catch (error) {
        logger.warn("Invalid atlas URL; disabling sync", {
          url: config.baseUrl,
          reason: error instanceof Error ? error.message : String(error),
        });
        this.enabled = false;
      }
    }
  }

  isEnabled(): boolean {
    return Boolean(this.enabled && this.baseUrl && this.apiKey);
  }

  async publishSource(source: MiningSource): Promise<boolean> {
    if (!this.isEnabled()) {
      return false;
    }
    const payload: SourcePayload = {
      id: source.id,
      name: source.name,
      baseUrl: source.baseUrl,
      type: source.type,
      notes: source.notes,
      region: undefined,
      status: "Live",
    };
    return this.postJson("/api/sources", payload, { context: { scope: "source", id: source.id } });
  }

  async publishArtifact(artifact: ScrapedArtifact, extras: { nodeId: string; source: MiningSource }): Promise<boolean> {
    if (!this.isEnabled()) {
      return false;
    }
    const metadata = (artifact.metadata ?? {}) as Record<string, unknown>;
    const payload: ArtifactPayload = {
      id: artifact.metadata?.atlasId as string | undefined,
      title: artifact.title,
      url: artifact.url,
      summary: artifact.summary,
      caption: (metadata.caption as string | undefined) ?? artifact.summary,
      year: pickYear(metadata),
      region: (metadata.region as string | undefined) ?? (metadata.location as string | undefined),
      sourceName: artifact.sourceName,
      sourceId: extras.source.id,
      lat: pickCoordinate(metadata.lat ?? metadata.latitude),
      lng: pickCoordinate(metadata.lng ?? metadata.longitude),
      discoveredBy: extras.nodeId,
    };
    return this.postJson("/api/artifacts", payload, {
      context: { scope: "artifact", url: artifact.url },
    });
  }

  private async postJson(path: string, payload: unknown, meta?: Record<string, unknown>): Promise<boolean> {
    if (!this.baseUrl || !this.apiKey) {
      return false;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = new URL(path.replace(/^\/+/, "/"), this.baseUrl);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        const errorBody = await safeText(response);
        logger.warn("Atlas sync request failed", {
          status: response.status,
          path: url.pathname,
          payload: meta,
          error: errorBody?.slice(0, 400),
        });
        return false;
      }
      return true;
    } catch (error) {
      logger.warn("Atlas sync request error", {
        path,
        payload: meta,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function pickYear(metadata: Record<string, unknown>): number | undefined {
  const candidates = [metadata.year, metadata.startYear, metadata.endYear, metadata.date];
  for (const value of candidates) {
    const num = pickCoordinate(value);
    if (typeof num === "number" && Number.isFinite(num)) {
      return Math.round(num);
    }
  }
  return undefined;
}

function pickCoordinate(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

async function safeText(response: Response): Promise<string | undefined> {
  try {
    return await response.text();
  } catch (error) {
    logger.debug("Failed reading worker response body", {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

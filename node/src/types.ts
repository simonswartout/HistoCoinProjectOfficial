export type SourceKind = "generic" | "met_api";

export interface MiningSource {
  id: string;
  name: string;
  baseUrl: string;
  type?: SourceKind;
  notes?: string;
  priority?: number;
}

export interface Cc0Verdict {
  isLikelyCc0: boolean;
  confidence: number; // 0..1
  evidence: string[];
}

export interface ScrapedArtifact {
  sourceId: string;
  sourceName: string;
  url: string;
  title: string;
  summary: string;
  imageUrl?: string;
  cc0: Cc0Verdict;
  metadata: Record<string, unknown>;
  rawTextSnippet: string;
  scrapedAt: string;
}

export interface NodeConfig {
  sources: MiningSource[];
}

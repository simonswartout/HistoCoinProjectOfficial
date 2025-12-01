export type SourceKind = "generic" | "met_api";

export interface CollectionTraversal {
  listingUrls?: string[];
  searchUrlTemplate?: string;
  searchTerms?: string[];
  resultItemSelector: string;
  linkAttribute?: string;
  maxItems?: number;
}

export interface LlamaAssessment {
  verdict: "historical" | "reject";
  confidence: number;
  tags: string[];
  reason: string;
}

export interface MiningSource {
  id: string;
  name: string;
  baseUrl: string;
  type?: SourceKind;
  notes?: string;
  priority?: number;
  collection?: CollectionTraversal;
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
  llamaAssessment?: LlamaAssessment;
}

export interface NodeConfig {
  sources: MiningSource[];
}

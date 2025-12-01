import { logger } from "./logger.js";
export class MasterClient {
    options;
    ingestUrl;
    constructor(options) {
        this.options = options;
        this.ingestUrl = new URL("/master/ingest", options.baseUrl);
    }
    async submit(artifact) {
        const payload = {
            url: artifact.url,
            node_id: this.options.nodeId,
            content: JSON.stringify({
                title: artifact.title,
                summary: artifact.summary,
                imageUrl: artifact.imageUrl,
                cc0: artifact.cc0,
                metadata: artifact.metadata,
                sourceId: artifact.sourceId,
                sourceName: artifact.sourceName,
                scrapedAt: artifact.scrapedAt,
                llamaAssessment: artifact.llamaAssessment,
            }),
        };
        const headers = {
            "Content-Type": "application/json",
        };
        if (this.options.token) {
            headers["Authorization"] = `Bearer ${this.options.token}`;
        }
        const response = await fetch(this.ingestUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Master ingest failed (${response.status}): ${text}`);
        }
        logger.info("Artifact submitted", { source: artifact.sourceId, title: artifact.title });
    }
}

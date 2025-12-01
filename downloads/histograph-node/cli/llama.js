import { logger } from "./logger.js";
const DEFAULT_TEMPERATURE = 0.1;
function buildPrompt(title, summary, snippet) {
    return `You are Meta Llama 3 verifying whether a web page describes a historically significant artifact that can be shared under permissive licensing. Respond with a single JSON object matching this TypeScript type:

{
  "verdict": "historical" | "reject",
  "confidence": number (0-1),
  "tags": string[],
  "reason": string
}

Guidance:
- verdict "historical" if the text clearly describes an artifact, document, or collection item with cultural or historical value.
- verdict "reject" if the page is unrelated, commercial, or lacks historical context.
- confidence reflects how certain you are (0-1).
- tags are short lowercase descriptors (e.g., ["bronze", "museum", "asia"]).

Artifact title: ${title}
Artifact summary: ${summary}
Artifact snippet: ${snippet.slice(0, 1200)}
`;
}
function extractJsonBlock(text) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
        return null;
    }
    return text.slice(start, end + 1);
}
export async function classifyArtifactWithLlama(title, summary, snippet, options) {
    const prompt = buildPrompt(title, summary, snippet);
    try {
        const response = await fetch(options.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: options.model,
                prompt,
                stream: false,
                temperature: options.temperature ?? DEFAULT_TEMPERATURE,
            }),
        });
        if (!response.ok) {
            const text = await response.text();
            logger.warn("Llama endpoint failed", { status: response.status, text });
            return null;
        }
        const data = (await response.json());
        const raw = data.response ?? data.output?.map((chunk) => chunk.text ?? chunk.content ?? "").join("") ?? "";
        const jsonBlock = extractJsonBlock(raw.trim());
        if (!jsonBlock) {
            logger.warn("Llama response missing JSON", { raw });
            return null;
        }
        const parsed = JSON.parse(jsonBlock);
        return parsed;
    }
    catch (error) {
        logger.warn("Llama classification error", {
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

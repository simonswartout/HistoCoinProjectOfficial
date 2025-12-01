import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
const DEFAULT_INDEX = { sources: [] };
function slugify(input) {
    const slug = input
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
    return slug || `source-${randomUUID().slice(0, 8)}`;
}
function normalizeUrl(raw) {
    const trimmed = raw.trim();
    if (!trimmed) {
        throw new Error("URL cannot be empty");
    }
    try {
        const hasScheme = /^(https?:)?\/\//i.test(trimmed);
        const url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
        url.hash = "";
        return url.toString().replace(/\/$/, "");
    }
    catch (error) {
        throw new Error(`Invalid URL: ${trimmed}`);
    }
}
async function ensureIndexFile(filePath) {
    const absolutePath = resolve(filePath);
    try {
        await access(absolutePath);
    }
    catch (error) {
        const code = error?.code;
        if (code === "ENOENT") {
            await mkdir(dirname(absolutePath), { recursive: true });
            await writeFile(absolutePath, JSON.stringify(DEFAULT_INDEX, null, 2) + "\n", "utf8");
        }
        else {
            throw error;
        }
    }
}
async function readIndex(filePath) {
    const absolutePath = resolve(filePath);
    await ensureIndexFile(absolutePath);
    const raw = await readFile(absolutePath, "utf8");
    const json = JSON.parse(raw);
    if (Array.isArray(json.sources)) {
        return { sources: json.sources };
    }
    return { ...DEFAULT_INDEX };
}
async function writeIndex(filePath, data) {
    const absolutePath = resolve(filePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}
export async function addSourceToIndex(options) {
    const baseUrl = normalizeUrl(options.url);
    const indexPath = resolve(options.indexPath);
    const index = await readIndex(indexPath);
    const existing = index.sources.find((src) => src.baseUrl.toLowerCase() === baseUrl.toLowerCase());
    if (existing) {
        return { added: false, source: existing };
    }
    const urlObj = new URL(baseUrl);
    const inferredName = options.name || `${urlObj.hostname} archive`;
    const source = {
        id: `${slugify(inferredName)}-${randomUUID().slice(0, 6)}`,
        name: inferredName,
        baseUrl,
        type: options.type ?? "generic",
        notes: options.notes,
        priority: options.priority,
    };
    index.sources.push(source);
    await writeIndex(indexPath, index);
    return { added: true, source };
}
export async function loadSourcesFromIndex(indexPath) {
    const list = await readIndex(indexPath);
    return list.sources;
}
export async function appendArtifactToIndex(options) {
    const safeTitle = options.artifactTitle?.slice(0, 60) || "Discovered artifact";
    const friendlyName = `${options.sourceName}: ${safeTitle}`.slice(0, 90);
    return addSourceToIndex({
        indexPath: options.indexPath,
        url: options.artifactUrl,
        name: friendlyName,
        notes: `Auto-discovered via ${options.sourceName}`,
    });
}

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET,POST,OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
	"Access-Control-Max-Age": "86400",
};

interface AtlasSource {
	id: string;
	name: string;
	baseUrl: string;
	region?: string;
	type?: string;
	notes?: string;
	artifactCount?: number;
	status?: string;
	lat?: number;
	lng?: number;
	createdAt: string;
	updatedAt: string;
}

interface AtlasArtifact {
	id: string;
	title: string;
	url: string;
	year?: number;
	region?: string;
	summary?: string;
	caption?: string;
	sourceName?: string;
	sourceId?: string;
	lat?: number;
	lng?: number;
	discoveredBy?: string;
	createdAt: string;
	updatedAt: string;
}

interface Env {
	ATLAS_SOURCES: KVNamespace;
	ATLAS_ARTIFACTS: KVNamespace;
	ATLAS_API_KEY: string;
	ATLAS_DATA_CACHE_SECONDS?: string;
}

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

export default {
	async fetch(request, env): Promise<Response> {
		if (request.method === "OPTIONS") {
			return new Response(null, { headers: CORS_HEADERS });
		}
		const url = new URL(request.url);
		if (request.method === "GET" && url.pathname === "/api/atlas") {
			return handleAtlasRequest(env);
		}
		if (request.method === "POST" && url.pathname === "/api/sources") {
			return authenticateAndHandle(request, env, (body) => persistSource(body, env));
		}
		if (request.method === "POST" && url.pathname === "/api/artifacts") {
			return authenticateAndHandle(request, env, (body) => persistArtifact(body, env));
		}
		if (request.method === "GET" && url.pathname === "/") {
			return textResponse("atlas worker ready", 200);
		}
		return jsonResponse({ error: "Not found" }, 404);
	},
} satisfies ExportedHandler<Env>;

function textResponse(message: string, status = 200): Response {
	return new Response(message, {
		status,
		headers: { ...CORS_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
	});
}

function jsonResponse(payload: JsonValue, status = 200, extraHeaders: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: {
			...CORS_HEADERS,
			"Content-Type": "application/json; charset=utf-8",
			...extraHeaders,
		},
	});
}

async function handleAtlasRequest(env: Env): Promise<Response> {
	const [sources, artifacts] = await Promise.all([
		listNamespace<AtlasSource>(env.ATLAS_SOURCES, "source:"),
		listNamespace<AtlasArtifact>(env.ATLAS_ARTIFACTS, "artifact:"),
	]);
	const updatedAt = determineNewestTimestamp([...sources, ...artifacts]);
	const cacheSeconds = Number(env.ATLAS_DATA_CACHE_SECONDS ?? "60");
	return jsonResponse(
		{
			sources,
			artifacts,
			updatedAt,
		},
		200,
		{ "Cache-Control": `public, max-age=${cacheSeconds}` }
	);
}

function determineNewestTimestamp(items: Array<{ updatedAt?: string }>): string {
	const newest = items
		.map((item) => Date.parse(item.updatedAt ?? ""))
		.filter((value) => Number.isFinite(value))
		.sort((a, b) => b - a)[0];
	return newest ? new Date(newest).toISOString() : new Date().toISOString();
}

async function authenticateAndHandle(
	request: Request,
	env: Env,
	handler: (body: Record<string, unknown>) => Promise<Response>
): Promise<Response> {
	const authHeader = request.headers.get("authorization") ?? request.headers.get("Authorization");
	if (!authHeader?.toLowerCase().startsWith("bearer ")) {
		return jsonResponse({ error: "Missing bearer token" }, 401);
	}
	const token = authHeader.slice(7).trim();
	if (!token || token !== env.ATLAS_API_KEY) {
		return jsonResponse({ error: "Invalid token" }, 401);
	}
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch (error) {
		return jsonResponse({ error: "Invalid JSON payload" }, 400);
	}
	return handler(body);
}

async function persistSource(body: Record<string, unknown>, env: Env): Promise<Response> {
	const name = stringField(body.name, 3, 200);
	const baseUrl = stringField(body.baseUrl ?? body.url, 5, 400);
	if (!name || !baseUrl) {
		return jsonResponse({ error: "Source name and baseUrl are required" }, 422);
	}
	const region = optionalString(body.region, 120);
	const type = optionalString(body.type, 120);
	const notes = optionalString(body.notes, 2000);
	const status = optionalString(body.status, 120);
	const artifactCount = optionalNumber(body.artifactCount);
	const lat = optionalNumber(body.lat);
	const lng = optionalNumber(body.lng);
	const keySeed = typeof body.id === "string" && body.id.trim().length > 0 ? body.id : `${name}:${baseUrl}`;
	const key = `source:${await hashKey(keySeed)}`;
	const existing = await env.ATLAS_SOURCES.get<AtlasSource>(key, "json");
	const now = new Date().toISOString();
	const record: AtlasSource = {
		id: existing?.id ?? key.replace(/^source:/, ""),
		name,
		baseUrl,
		region: region ?? existing?.region,
		type: type ?? existing?.type,
		notes: notes ?? existing?.notes,
		status: status ?? existing?.status,
		artifactCount: artifactCount ?? existing?.artifactCount,
		lat: lat ?? existing?.lat,
		lng: lng ?? existing?.lng,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
	};
	await env.ATLAS_SOURCES.put(key, JSON.stringify(record));
	return jsonResponse(record, existing ? 200 : 201);
}

async function persistArtifact(body: Record<string, unknown>, env: Env): Promise<Response> {
	const title = stringField(body.title, 3, 400);
	const url = stringField(body.url, 5, 2048);
	if (!title || !url) {
		return jsonResponse({ error: "Artifact title and url are required" }, 422);
	}
	const caption = optionalString(body.caption, 2000) ?? optionalString(body.summary, 2000);
	const region = optionalString(body.region, 200);
	const sourceName = optionalString(body.sourceName, 200);
	const sourceId = optionalString(body.sourceId, 200);
	const discoveredBy = optionalString(body.discoveredBy, 200);
	const year = optionalNumber(body.year);
	const lat = optionalNumber(body.lat);
	const lng = optionalNumber(body.lng);
	const keySeed = typeof body.id === "string" && body.id.trim().length > 0 ? body.id : url;
	const key = `artifact:${await hashKey(keySeed)}`;
	const existing = await env.ATLAS_ARTIFACTS.get<AtlasArtifact>(key, "json");
	const now = new Date().toISOString();
	const record: AtlasArtifact = {
		id: existing?.id ?? key.replace(/^artifact:/, ""),
		title,
		url,
		year: typeof year === "number" ? Math.round(year) : existing?.year,
		region: region ?? existing?.region,
		summary: optionalString(body.summary, 4000) ?? existing?.summary,
		caption: caption ?? existing?.caption,
		sourceName: sourceName ?? existing?.sourceName,
		sourceId: sourceId ?? existing?.sourceId,
		lat: lat ?? existing?.lat,
		lng: lng ?? existing?.lng,
		discoveredBy: discoveredBy ?? existing?.discoveredBy,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
	};
	await env.ATLAS_ARTIFACTS.put(key, JSON.stringify(record));
	return jsonResponse(record, existing ? 200 : 201);
}

async function listNamespace<T>(namespace: KVNamespace, prefix: string): Promise<T[]> {
	const results: T[] = [];
	let cursor: string | undefined = undefined;
	while (true) {
		const page = await namespace.list({ prefix, cursor });
		for (const entry of page.keys) {
			const value = await namespace.get<T>(entry.name, "json");
			if (value) {
				results.push(value);
			}
		}
		if (page.list_complete || !page.cursor) {
			break;
		}
		cursor = page.cursor;
	}
	return results;
}

async function hashKey(input: string): Promise<string> {
	const data = new TextEncoder().encode(input.trim());
	const digest = await crypto.subtle.digest("SHA-256", data);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stringField(value: unknown, min = 1, max = 1024): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (!trimmed || trimmed.length < min) return undefined;
	return trimmed.slice(0, max);
}

function optionalString(value: unknown, max = 1024): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	return trimmed.slice(0, max);
}

function optionalNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}


# Atlas Worker

Cloudflare Worker that stores live source and artifact metadata for the atlas UI. Data is persisted in KV namespaces and exposed via a small JSON API so static clients can fetch updates without redeploying the site.

## Endpoints

| Method | Path             | Description                           |
|--------|------------------|---------------------------------------|
| GET    | `/api/atlas`     | Returns `{ sources, artifacts }` plus `updatedAt`. Public, CORS-enabled. |
| POST   | `/api/sources`   | Adds or updates a source record. Requires `Authorization: Bearer <ATLAS_API_KEY>`. |
| POST   | `/api/artifacts` | Adds or updates an artifact record. Requires `Authorization: Bearer <ATLAS_API_KEY>`. |
| GET    | `/`              | Plain health check string.            |

All POST payloads accept simple JSON with the fields used in `src/index.ts`. Records are keyed deterministically by URL or explicit `id`, so repeat submissions update the existing entry.

## Local development

```bash
cd worker-atlas
npm install
# optional: keep worker running locally
npm run dev
```

## Cloudflare configuration

1. Create the KV namespaces and copy the resulting IDs into `wrangler.jsonc`:
   ```bash
   wrangler kv:namespace create ATLAS_SOURCES
   wrangler kv:namespace create ATLAS_ARTIFACTS
   ```
2. Add the production IDs to `id` and the preview IDs to `preview_id` under `kv_namespaces`.
3. Store the API key secret:
   ```bash
   wrangler secret put ATLAS_API_KEY
   ```
4. (Optional) tweak public cache control via `ATLAS_DATA_CACHE_SECONDS` in `wrangler.jsonc`.

## Deploy

```bash
npm run deploy
```

After deployment, note the worker URL (e.g. `https://histocoin-atlas.workers.dev`). Configure the crawler and frontend to use that base URL for pushing and fetching live atlas data.

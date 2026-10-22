---
"@stax-ui/platform": minor
---

feat(platform): colocated `_data.json` per SSG page

SSG builds now emit a `_data.json` file next to each page's `index.html`, carrying the loader data in the same shape as the embedded `window.__STAX_DATA__` script. `makeClientLayer`'s `RouteDataProvider` tries this file first on client-side navigation.

**Why.** Before this, client-side navigation on a static host relied on regex-extracting the embedded `__STAX_DATA__` script from the HTML response to `?_data=1`. Static hosts (and `vite preview`'s SPA fallback) often serve the wrong HTML — e.g. the root `index.html` for `/docs/introduction` — which caused the client to silently extract the wrong route's data. The caller then saw structurally-valid-but-wrong data and (if the route's meta or render dereferenced a field) crashed with a mysterious TypeError.

The new path removes the ambiguity. A direct JSON file either returns the right data or 404s — no silent wrong-data extraction.

**Fallback order on client navigation:**

1. **Colocated `${path}/_data.json`** — new SSG default. Fast, cacheable, no HTML parsing.
2. **`${path}?_data=1`** — SSR servers' existing JSON handler. Unchanged behavior.
3. **HTML extraction** — legacy fallback for older SSG builds (and a loud warning now points at the fix).

**Emitted by two codepaths:**

- `Platform.buildStaticSite` (direct API) — the file-write loop writes HTML + sibling JSON.
- `ssg-adapter-runtime` (the Vite plugin's SSG build path, which is what `vite build` actually uses) — fires a second `?_data=1` request at the user's handler for each page and writes the JSON response.

The second-request approach keeps the SSG runtime decoupled from the HTML format and lets the handler's existing data-request branch do the serialization. Loader runs twice per page during build — acceptable for correctness; can optimise later behind a flag.

**Tests.** Two new buildStaticSite tests verify `_data.json` lands next to `index.html` for every route, and that the fallback 404 page is correctly skipped.

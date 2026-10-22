---
"@stax-ui/platform": minor
"@stax-ui/router": patch
---

feat(platform): hydration data is now a non-executable JSON block

Replaces the previous inline executable script with a `type="application/json"` data block:

```html
<!-- before -->
<script>window.__STAX_DATA__={...}</script>

<!-- after -->
<script type="application/json" id="__stax_data">{...}</script>
```

### Why

- **CSP compatibility by default.** `script-src` only governs scripts the browser *executes*. A `type="application/json"` block is never executed, so it needs no nonce and no inline-script hash. SSG output now runs under a plain `script-src 'self'` with zero configuration — which is important because static pages can't carry nonces.
- **This was stax's only inline executable script.** Removing it means strict CSP is reachable without any further framework-level opt-in. Build 2 of the CSP proposal (per-request nonce support) remains to make SSR work under `script-src 'nonce-…' 'strict-dynamic'`; this change makes the simpler case work now.
- **Side benefit: no global on `window`.** Hydration data isn't readable by third-party scripts through a well-known handle, and can't collide with other `__STAX_*` globals.

### Backward compatibility

- **SSR output ships new-format only** (not both — double-emitting would bloat the HTML).
- **Hydration reader accepts both formats for one minor cycle.** `readEmbeddedHydrationData` tries the new `#__stax_data` block first, falls back to `window.__STAX_DATA__` for rolling deploys where a cached old HTML served to a new client bundle still needs to hydrate.
- **`extractEmbeddedRouteData` (HTML extraction for the SSG client-nav fallback) also accepts both formats.** New block preferred when both are present.

Clients deployed on this version continue to hydrate pages served from older stax versions. One minor from now the legacy fallback can be removed.

### Not in this release

The broader CSP support proposal — per-request nonce generation, `CspNonce` service, renderer-side nonce application, dev server integration — is tracked separately. This change is a prerequisite for strict-CSP SSG; the SSR flavor needs the nonce pipeline.

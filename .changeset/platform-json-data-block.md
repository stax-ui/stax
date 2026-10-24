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

- **CSP compatibility by default.** `script-src` only governs scripts the browser _executes_. A `type="application/json"` block is never executed, so it needs no nonce and no inline-script hash. SSG output now runs under a plain `script-src 'self'` with zero configuration — which is important because static pages can't carry nonces.
- **This was stax's only inline executable script.** Removing it means strict CSP is reachable without any further framework-level opt-in. Build 2 of the CSP proposal (per-request nonce support) remains to make SSR work under `script-src 'nonce-…' 'strict-dynamic'`; this change makes the simpler case work now.
- **Side benefit: no global on `window`.** Hydration data isn't readable by third-party scripts through a well-known handle, and can't collide with other `__STAX_*` globals.

### Breaking change

Clean cut. The legacy `window.__STAX_DATA__` global is no longer emitted and no longer read — neither at hydration time nor via the SSG client-nav HTML-extraction fallback. A client bundle from this version will not hydrate pages served from an older platform build, and vice versa.

If you're deploying this upgrade in-place, redeploy the server (SSR) or regenerate the HTML (SSG) at the same time as the client bundle; there's no overlap window to worry about.

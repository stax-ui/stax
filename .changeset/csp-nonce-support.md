---
"@stax-ui/dom": minor
"@stax-ui/platform": minor
---

feat(dom,platform): per-request Content Security Policy nonce support

Lets a stax app serve strict `script-src 'nonce-…'` / `style-src 'nonce-…'` policies end-to-end, without the app having to pass the per-request nonce around by hand.

### What ships

**`CspNonce` service in `@stax-ui/dom`.** New context tag + service type. Not required by anyone — every consumer reads it via `Effect.serviceOption(CspNonce)` so the nonce stays off `R`.

**`enableCspNonce` pipeable modifier.** Applied at the factory definition site in `DOMElements.ts` — `$.script` and `$.style` are built via `enableCspNonce(makeElementFactory("script"))`, so the divergence from the stock behavior lives at the three CSP-sensitive factories, not inside `makeElementFactory`. Reads the ambient nonce and stamps it onto the attribute set unless the caller provided an explicit `nonce`.

**`csp` option on `Platform.toHttpRoutes`.** Opts in per-route-group:

```ts
Platform.toHttpRoutes(router, {
  app,
  document: { title: "My App", scripts: ["/assets/client.js"] },
  csp: {
    nonce: true,                               // or (request) => string
    policy: (nonce) =>
      `script-src 'nonce-${nonce}' 'strict-dynamic'; ` +
      `style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'`,
    reportOnly: false,                         // sends CSP-Report-Only when true
  },
});
```

- `nonce: true` generates 16 random bytes (base64) per request via `crypto.getRandomValues`.
- `nonce: fn` sources from upstream middleware.
- `policy` writes the response header. Omit to set it yourself (reverse proxy / middleware).
- `reportOnly` switches to `Content-Security-Policy-Report-Only` for rollout.

**Automatic client pickup.** `hydrate` and `mount` read `<meta property="csp-nonce" nonce="…">` from the document and provide `CspNonce` into the client-side render scope. Zero code change in the app — all `$.script` / `$.style` elements the client creates post-mount get the stamp automatically.

**`generateDocument` emits the stamp.** When a nonce is passed:
- `<meta property="csp-nonce" nonce="…">` lands in `<head>` so the client can pick it up.
- `nonce="…"` is added to every `<script type="module">` and `<link rel="stylesheet">` the document shell emits.

### Design decisions worth calling out

- **No change to `makeElementFactory`.** The CSP divergence lives at the factory definition site via `enableCspNonce`, keeping the stock factory uniform for all tags. `$.div`, `$.span`, etc. stay zero-overhead.
- **`CspNonce` is never on anyone's `R`.** Readers use `Effect.serviceOption`, which returns `None` when no boundary provided it. Apps that don't use CSP pay nothing — no required service, no error, no behavioral change.
- **Explicit nonce wins.** Rare but legitimate (embedding a third-party script with its own policy-matching nonce).

### Not in this release

- `document.head` as a function (so raw head HTML can carry the nonce) — follow-up.
- Dev-server integration (`html.cspNonce` placeholder swap in the Vite plugin) — follow-up, Vite-version brittle.
- Node adapter CSP option — `toHttpRoutes` covers the request pipeline; adapter-level config would be redundant.
- Build-time SHA256 hash support for user-embedded inline scripts in SSG output — defer indefinitely. Part 1 (`feat/platform-json-data-block`) removed stax's only inline executable script, so SSG runs under `script-src 'self'` without any hashes.

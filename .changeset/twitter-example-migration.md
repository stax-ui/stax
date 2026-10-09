---
"twitter-demo": patch
---

chore(twitter): migrate to the Node adapter + framework-owned lifecycle

Third follow-up in the #169 series. Collapses the twitter example's
`src/vite-entry.ts` + `src/server.ts` into a single `src/main.ts` using
the same `makeApp(opts)` + `AppLayer` shape as the SSR template.

Nice demonstration of the full "backend alongside Stax" pattern in one
place — `main.ts` now shows:

- Stax SSR routes composed via `Platform.toHttpRoutes`
- A plain Effect HttpRouter API route (`/api/health`) composed alongside
  the Stax routes
- A service layer (`PostServiceLive`) provided at server scope via
  `AppLayer`

`vite.config.ts` uses `nodeAdapter({ port: 3002, styles: [] })` — twitter
loads its CSS via `client.ts`'s `import "./styles.css"` which Vite
bundles into the client bundle, so no top-level `<link>` tag is needed.
Build/dev/serve all verified end-to-end: `/` renders SSR'd, `/api/health`
returns `{"ok":true}`, `/client.js` serves the 333 kB client bundle.

Builds on #170.

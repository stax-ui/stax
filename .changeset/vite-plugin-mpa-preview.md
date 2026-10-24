---
"@stax-ui/platform": minor
"@stax-ui/vite-plugin": minor
---

feat(platform,vite-plugin): `ssgAdapter` opts into MPA preview + pretty-URL middleware

Makes `vite preview` behave like a real static host for SSG output.

Vite's default `appType: "spa"` falls back to the root `/index.html` for any URL that isn't a direct file hit. For an SSG app that means `GET /docs/introduction` returns the HOMEPAGE's HTML — which bites every time you build and `pnpm preview`. Switching to `appType: "mpa"` prevents the SPA fallback but introduces a different gap: Vite preview serves files literally and doesn't do the "pretty URL" directory-index resolution that production hosts (Cloudflare Pages, Netlify, nginx, GitHub Pages, S3+CloudFront) do.

This change closes both gaps:

1. **New adapter field `previewOptions.appType`.** The `StaxAdapter` contract grows a `previewOptions` shape mirroring `clientBuildOptions`. `ssgAdapter()` sets `appType: "mpa"` by default; the Node adapter leaves it unset (it runs its own HTTP server). The vite-plugin reads this and applies it to Vite's top-level `appType`.

2. **Pretty-URL preview middleware.** The vite-plugin adds a `configurePreviewServer` hook that, when the adapter opts into `mpa`, rewrites `req.url` from `/path` to `/path/index.html` when the matching directory exists in the build output. One request, prod-shaped behavior. No redirect.

The two together let `vite preview` serve `GET /docs/introduction` from `dist/docs/introduction/index.html` directly — matching every production static host and lining up with the colocated `_data.json` fetch flow from the previous change in this stack.

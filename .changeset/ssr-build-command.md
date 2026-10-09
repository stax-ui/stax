---
"create-stax-ui": patch
---

fix(create-stax-ui): SSR template's `pnpm build` now actually builds the server bundle

The SSR template's build script was `"vite build"`, which only runs the client build and emits `dist/client/client.js`. Nothing produced `dist/server/index.js`, so `pnpm serve` (which runs `node dist/server/index.js`) would exit with "module not found" on a freshly-scaffolded project.

The vite-plugin needs two invocations to emit both bundles — one for the client, one for `--ssr` which triggers the plugin's SSR config branch and bundles the virtual `virtual:@stax-ui/platform/ssr-entry` module into `dist/server/index.js`. Fixed by setting `"build": "vite build && vite build --ssr"`, matching the SSG template and the in-repo docs app.

Verified end-to-end: fresh scaffold → `pnpm build` → both `dist/client/client.js` and `dist/server/index.js` emit → `pnpm serve` returns a hydratable SSR'd page at HTTP 200.

Follow-up worth tracking separately: Vite 7's `builder.buildApp` API lets a plugin declare multiple environments and run both from a single `vite build`. Moving the client + SSR coordination inside `@stax-ui/vite-plugin` would let users drop back to `"vite build"`.

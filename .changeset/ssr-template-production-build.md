---
"create-stax-ui": patch
---

fix: SSR template production build now emits a working client bundle

The `--ssr` template's `build` script was `vite build && vite build --ssr
src/client.ts`. The second step built the client entry **as SSR**, emitting
`dist/client.js` with bare imports (`import { hydrate } from "@stax-ui/dom/hydrate"`,
etc.) that browsers can't execute. `server.ts` references `/client.js`, so
production pages SSR-rendered but never hydrated — no console error on the
server side, just a non-interactive page.

The template now builds `src/client.ts` as a real browser bundle at a stable
`dist/client.js` filename:

- `vite.config.ts` sets `build.rollupOptions.input = "src/client.ts"` and
  `output.entryFileNames = "client.js"`.
- `package.json` build script is just `vite build`.

Verified: production page hydrates, server's `document.scripts: ["/client.js"]`
agrees with the emitted filename. `examples/twitter` got the same treatment.

A longer-term fix — having `staxPlatform` own the client build config so the
template doesn't have to — is tracked separately. This PR unblocks the
immediate "scaffold doesn't work in production" case.

Fixes #162.

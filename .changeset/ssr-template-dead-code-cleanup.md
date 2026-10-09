---
"create-stax-ui": patch
---

chore(create-stax-ui): remove dead files from the SSR template left over from the Node adapter migration

The SSR template's Node adapter migration (#169) added `src/main.ts` and reshaped `vite.config.ts` around `staxPlatform({ app, client, adapter })`, but didn't remove the files the new shape replaces:

- `src/vite-entry.ts` — the old dev-server SSR entry. The plugin now synthesizes the SSR entry via its virtual `virtual:@stax-ui/platform/ssr-entry` module from the `app` option, so a user-written entry is no longer needed.
- `src/server.ts` — the old prod Node bootstrap. `nodeAdapter` generates `dist/server/index.js` and `pnpm serve` runs that directly.

Neither file was referenced from anywhere in the template (`vite.config.ts` points at `src/main.ts` + `src/client.ts`; nothing imports the old files). Removing them shrinks the scaffolded project to the files the user actually edits.

Also tightened a stale comment in `vite.config.ts` that still named `server.ts` as the thing referencing `/client.js` — the generated server bundle is what references it now.

No API change. Users running `pnpm create stax-ui` get a cleaner starting tree with the same behavior.

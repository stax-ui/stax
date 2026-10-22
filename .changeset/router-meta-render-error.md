---
"@stax-ui/router": minor
---

feat(router): typed `MetaRenderError` on Outlet's E channel

A route's `meta` function runs user-written code that typically reads fields off the loader's `data`. When data shape doesn't match (e.g. SSG client-side nav briefly loading the wrong page's blob, loader stripped by the Vite transform leaving `data` undefined, or a drift between the loader's output and what the meta function expects), the dereference throws — currently as an unanchored `TypeError` logged under `stax.reconcile` and swallowed.

This change surfaces that failure as a tagged `MetaRenderError` and adds it to the Route's E channel when `Route.meta(...)` is applied, so the risk shows up in the type at the call site. Users can:

```ts
hydrate(DocLayout().pipe(
  Effect.catchTag("MetaRenderError", (e) =>
    Effect.sync(() => {
      // log to Sentry, render a fallback, etc.
      return someFallbackElement;
    }),
  ),
), ...);
```

### What propagates where

- **Initial render** — Outlet's first sync propagates to the caller. `Effect.catchTag("MetaRenderError", ...)` works here.
- **Subsequent navigation syncs** — run on a forked subscription fiber via `Effect.forkScoped`; failures stay in the fiber. These still get logged under `stax.reconcile`, now with the error's `_tag` carried through, but the catchTag path doesn't apply. The subscription survives either way, matching today's behavior.

### What's not in this PR

- `LoaderError` and `RouteRenderError` as sibling typed errors — their design intersects with reconcile's subscription-survival guarantee in ways that need a bigger architectural look (see the thread on #190). Follow-up PRs if we decide to go further.
- Propagating subscription-path typed errors to `catchTag` requires reshaping how `ctx.subscribe` surfaces its forked fiber's failures. Also a separate PR.

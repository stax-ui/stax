---
"@stax-ui/platform": patch
---

Fix `AsyncCache` leaking into `R` in `toHttpRoutes` and `buildStaticSite` type signatures

Both `Platform.toHttpRoutes` and `Platform.buildStaticSite` provide an
`AsyncCache` layer per request / per page at runtime (see
`Platform.ts:546` for the SSR path, `:1138` and `:1199` for the SSG
paths), but their public type signatures didn't list `AsyncCache`
among the services the app's `R` was allowed to require, and
`toHttpRoutes`'s return `Exclude` didn't strip it from the output.

Concretely:

- `ToHttpRoutesOptions.app`'s `R` enumerated the services the shell
  needs (`NavigationContext | RouteDataContext | RendererContext |
  ControlCtx | SuspenseBoundaryCtx | Scope.Scope`) but omitted
  `AsyncCache`, so any app whose render tree reached `AsyncCache`
  directly (`yield* AsyncCache`) was rejected at the call site.
- The returned `HttpRouter`'s `R` stripped the same list via
  `Exclude<R, …>`, so `AsyncCache` leaked up through the returned
  router's `R` and failed to match `HttpRouter.Default`'s expected
  context in downstream callers.
- `BuildStaticSiteOptions.app` was even more restrictive — `R =
  never` — so any SSG app shell that reached any of the services the
  implementation provides was rejected, not just ones touching
  `AsyncCache`.

Reproducer on `main` before this fix: `cd examples/twitter && pnpm
exec tsc --noEmit` — the Feed page's `const cache = yield*
AsyncCache` surfaces `AsyncCache` on its `R`, which leaks up through
`Outlet` → `App` → `toHttpRoutes` and fails two separate type checks
in `src/vite-entry.ts`.

Fixed by adding `AsyncCache` to the two allowed-`R` unions in
`toHttpRoutes` and widening `BuildStaticSiteOptions.app.R` to match
the SSR shell's full service list. This is semver-safe: the input
union widens (accepting more callers), and the output `Exclude`
widens in the strip-more direction — no previously-valid caller is
now rejected.

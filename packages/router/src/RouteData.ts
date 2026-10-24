import { Context, Effect } from "effect";

import type { Route } from "./Route.js";

// =============================================================================
// RouteDataContext
// =============================================================================

/**
 * Data provided to a route's render function by the platform.
 *
 * - `data` — result of the route's `Route.get()` loader (or `undefined` if none)
 * - `loaderPath` — URL to refetch the loader data (appends `?_data=1` to the route path)
 * - `actions` — map of handler key → URL path for POST/PUT/DELETE endpoints
 */
export interface RouteDataService {
  readonly data: unknown;
  readonly loaderPath: string;
  readonly actions: Readonly<Record<string, string>>;
}

/**
 * Context tag for route data.
 *
 * Components access loader data and action endpoint paths through this context.
 * Platform provides the implementation (server: runs loader, client: hydration/fetch).
 *
 * @example
 * ```ts
 * Route.render(() => Effect.gen(function* () {
 *   const { data, loaderPath, actions } = yield* RouteDataContext;
 *   const user = data as User;
 *
 *   // Refetch loader data
 *   const fresh = yield* Effect.tryPromise(() => fetch(loaderPath).then(r => r.json()));
 *
 *   // Submit to a mutation handler
 *   return yield* $.form({ action: actions.updateProfile, method: "POST" },
 *     // ...
 *   );
 * }))
 * ```
 */
export class RouteDataContext extends Context.Tag("@stax-ui/router/RouteData")<
  RouteDataContext,
  RouteDataService
>() {}

// =============================================================================
// RouteDataProvider
// =============================================================================

/**
 * Abstract service for fetching route data.
 *
 * Platform provides implementations:
 * - Server: executes the loader directly
 * - Client (hydration): reads the embedded `<script type="application/json"
 *   id="__stax_data">` block
 * - Client (navigation): fetches from server via `?_data=1`
 */
export interface RouteDataProviderService {
  readonly getRouteData: <P, S, D, E, R>(
    route: Route<string, P, S, D, E, R>,
    params: Record<string, string>,
    searchParams: Record<string, string>,
  ) => Effect.Effect<RouteDataService>;
}

/**
 * Context tag for the route data provider.
 *
 * Outlet uses this to obtain data before rendering a route.
 * Only accessed when a route has `_loader` or `_handlers`.
 */
export class RouteDataProvider extends Context.Tag(
  "@stax-ui/router/RouteDataProvider",
)<RouteDataProvider, RouteDataProviderService>() {}

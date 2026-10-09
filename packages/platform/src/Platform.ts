/**
 * Platform utilities for SSR integration.
 *
 * Provides `toHttpRoutes` which converts an Stax Router into an
 * `@effect/platform` HttpRouter, handling SSR rendering, data requests
 * (`?_data=1`), and action execution (`POST/PUT/DELETE ?_action=key`).
 *
 * Route-level hooks drive behavior:
 * - `Route.get()` loaders run on GET requests only
 * - `Route.post()/put()/delete()` handlers run on their respective methods only
 * - POST/PUT/DELETE handlers execute directly — no component tree rendering
 *
 * @module
 */

import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform";
import type { RouteNotFound } from "@effect/platform/HttpServerError";
import {
  Console,
  Data,
  Effect,
  Layer,
  Record,
  Ref,
  Schema,
  Scope,
} from "effect";

import {
  AsyncCache,
  Element,
  makeAsyncCache,
  makeIdGeneratorLayer,
  RendererContext,
  type ControlCtx,
  type SuspenseBoundaryCtx,
} from "@stax-ui/dom";
import { renderToString } from "@stax-ui/dom/server";
import {
  Navigation,
  NavigationContext,
  resolveMeta,
  RouteDataContext,
  RouteDataProvider,
  type RouteDataProviderService,
  type RouteDataService,
  type RouteType,
  type Router as StaxRouter,
} from "@stax-ui/router";

// =============================================================================
// Types
// =============================================================================

export interface DocumentOptions {
  /** Page title */
  readonly title?: string;
  /** Script URLs to include */
  readonly scripts?: readonly string[];
  /** Stylesheet URLs to include */
  readonly styles?: readonly string[];
  /** Additional head content */
  readonly head?: string;
  /** Attributes to add to the <html> element */
  readonly htmlAttrs?: Record<string, string>;
}

export interface ToHttpRoutesOptions {
  /** Document generation options */
  readonly document?: DocumentOptions;
  /**
   * Root app component to render on the server.
   * This should be the same component tree the client hydrates.
   * It should contain an Outlet that renders matched routes.
   *
   * If not provided, renders just the matched route with layouts.
   */
  readonly app?: () => Element.Element<
    HTMLElement | SVGElement,
    never,
    | NavigationContext
    | RouteDataContext
    | RendererContext
    | ControlCtx
    | SuspenseBoundaryCtx
    | Scope.Scope
  >;
}

// =============================================================================
// Errors
// =============================================================================

/**
 * Redirect error thrown from loaders or action handlers.
 */
export class RedirectError extends Data.TaggedError("RedirectError")<{
  readonly url: string;
  readonly status: number;
}> {}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Serialize data for embedding in HTML (escapes script-breaking characters)
 */
export const serializeForHtml = (data: unknown): string => {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
};

/**
 * Generate the script tag for embedding loader data
 */
export const generateLoaderDataScript = (
  loaderData: Record<string, unknown>,
): string => {
  if (Object.keys(loaderData).length === 0) return "";
  return `<script>window.__STAX_DATA__=${serializeForHtml(loaderData)}</script>`;
};

/**
 * Generate a full HTML document wrapping rendered content.
 */
export const generateDocument = (
  html: string,
  loaderData: Record<string, unknown>,
  options?: DocumentOptions,
  meta?: { title?: string; description?: string },
): string => {
  // Route-level meta overrides document-level options
  const titleText = meta?.title ?? options?.title;
  const title = titleText ? `<title>${titleText}</title>` : "";
  const description = meta?.description
    ? `<meta name="description" content="${meta.description.replace(/"/g, "&quot;")}">`
    : "";
  const styles = (options?.styles ?? [])
    .map((href) => `<link rel="stylesheet" href="${href}">`)
    .join("\n    ");
  const scripts = (options?.scripts ?? [])
    .map((src) => `<script type="module" src="${src}"></script>`)
    .join("\n    ");
  const head = options?.head ?? "";
  const loaderScript = generateLoaderDataScript(loaderData);
  const htmlAttrs = options?.htmlAttrs
    ? " " +
      Object.entries(options.htmlAttrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ")
    : "";

  return `<!DOCTYPE html>
<html${htmlAttrs}>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    ${title}
    ${description}
    ${styles}
    ${head}
  </head>
  <body>
    <div id="root">${html}</div>
    ${loaderScript}
    ${scripts}
  </body>
</html>`;
};

/**
 * Substitute route params into a path pattern.
 * e.g., "/users/:id" + { id: "123" } → "/users/123"
 */
const substituteParams = (
  path: string,
  params: Record<string, string>,
): string => {
  let result = path;
  for (const [key, value] of Object.entries(params)) {
    if (key === "*") {
      // Catchall — replace the trailing * with the value (no encoding)
      result = result.replace("*", value);
    } else {
      result = result.replace(`:${key}`, encodeURIComponent(value));
    }
  }
  return result;
};

/**
 * Compute action paths for a route's handlers given current params.
 */
const computeActionPaths = <P, S, D, E, R>(
  route: RouteType<string, P, S, D, E, R>,
  params: Record<string, string>,
): Record<string, string> => {
  const actions: Record<string, string> = {};
  for (const h of route._handlers) {
    const basePath = substituteParams(route.path, params);
    actions[h.key] = `${basePath}?_action=${encodeURIComponent(h.key)}`;
  }
  return actions;
};

/**
 * Validate route params against the route's schema.
 */
const validateParams = <P, S, D, E, R>(
  route: RouteType<string, P, S, D, E, R>,
  rawParams: Record<string, string>,
): Effect.Effect<P, unknown> => {
  if (route.paramsSchema) {
    return Schema.decodeUnknown(route.paramsSchema)(rawParams);
  }
  return Effect.succeed(rawParams as unknown as P);
};

/**
 * Validate search params against the route's schema.
 */
const validateSearchParams = <P, S, D, E, R>(
  route: RouteType<string, P, S, D, E, R>,
  rawSearchParams: Record<string, string>,
): Effect.Effect<S, unknown> => {
  if (route.searchParamsSchema) {
    return Schema.decodeUnknown(route.searchParamsSchema)(rawSearchParams);
  }
  return Effect.succeed(rawSearchParams as unknown as S);
};

// Redirect handling helper — uses _tag check to work with generic E
const catchRedirects = (
  handler: Effect.Effect<unknown, unknown, unknown>,
): Effect.Effect<unknown, unknown, unknown> =>
  handler.pipe(
    Effect.catchAll((error) => {
      if (error && typeof error === "object" && "_tag" in error) {
        const tag = (error as { _tag: string })._tag;
        if (tag === "RedirectError") {
          const e = error as RedirectError;
          return Effect.succeed(
            HttpServerResponse.redirect(e.url, { status: e.status }),
          );
        }
      }
      return Effect.fail(error);
    }),
  );

// =============================================================================
// toHttpRoutes
// =============================================================================

/**
 * Convert an Stax Router into an `@effect/platform` HttpRouter.
 *
 * For each route in the Stax Router, registers method-specific handlers:
 *
 * - **GET**: Runs the route's loader (if any), provides data via RouteDataContext,
 *   SSR renders the component. If `?_data=1`, returns data as JSON.
 * - **POST/PUT/DELETE**: Looks up the handler by `?_action=key`, executes it
 *   directly with the parsed request body. No component rendering.
 *
 * Redirect errors are caught and converted to HTTP redirect responses.
 */
export const toHttpRoutes = <
  P extends Record<string, unknown> | never,
  S extends Record<string, unknown> | never,
  D,
  R,
>(
  router: StaxRouter<P, S, D, never, R>,
  options?: ToHttpRoutesOptions,
): HttpRouter.HttpRouter<
  RedirectError | RouteNotFound,
  Exclude<
    R,
    | RouteDataContext
    | RouteDataProvider
    | NavigationContext
    | RendererContext
    | ControlCtx
    | SuspenseBoundaryCtx
    | Scope.Scope
  >
> => {
  // Use renderToString with widened types
  const render = renderToString as (
    element: unknown,
  ) => Effect.Effect<string, unknown, unknown>;

  let httpRouter = HttpRouter.empty as HttpRouter.HttpRouter<unknown, unknown>;

  for (const route of router.routes) {
    const path = route.path as `/${string}`;

    // -------------------------------------------------------------------
    // GET handler: Run loader → SSR render or return data JSON
    // -------------------------------------------------------------------
    const getHandler = Effect.gen(function* () {
      const serverRequest = yield* HttpServerRequest.HttpServerRequest;
      const url = new URL(serverRequest.url, "http://localhost");
      const isDataRequest = url.searchParams.has("_data");

      // Get route params extracted by @effect/platform's path matching
      const rawRouteParams = yield* HttpRouter.params;
      const rawSearchParams = Object.fromEntries(url.searchParams);

      // Validate params
      const validatedParams = yield* validateParams(
        route,
        rawRouteParams as Record<string, string>,
      );
      const validatedSearchParams = yield* validateSearchParams(
        route,
        rawSearchParams,
      );

      // Run loader if present — catch RedirectError so we can return
      // an appropriate response for data requests vs full page loads
      const loaderFn = route._loader
        ? (route._loader as (args: {
            params: unknown;
            searchParams: unknown;
          }) => Effect.Effect<D, unknown, unknown>)
        : route._staticConfig?.load
          ? (route._staticConfig.load as (args: {
              params: unknown;
            }) => Effect.Effect<D, unknown, unknown>)
          : null;

      if (loaderFn) {
        const loaderOrRedirect = yield* loaderFn({
          params: validatedParams,
          searchParams: validatedSearchParams,
        }).pipe(
          Effect.map((data) => ({ redirect: false as const, data })),
          Effect.catchAll((error) => {
            if (
              error &&
              typeof error === "object" &&
              "_tag" in error &&
              (error as { _tag: string })._tag === "RedirectError"
            ) {
              const e = error as RedirectError;
              return Effect.succeed({
                redirect: true as const,
                url: e.url,
                status: e.status,
                data: undefined,
              });
            }
            return Effect.fail(error);
          }),
        );

        if (loaderOrRedirect.redirect) {
          if (isDataRequest) {
            // Data requests get a JSON redirect signal so the client can
            // trigger a client-side navigation instead of an HTTP redirect
            return yield* HttpServerResponse.json({
              _redirect: loaderOrRedirect.url,
            });
          }
          return HttpServerResponse.redirect(loaderOrRedirect.url, {
            status: loaderOrRedirect.status,
          });
        }

        // Continue with loader data below
        // eslint-disable-next-line
        var loaderData = loaderOrRedirect.data;
      } else {
        // eslint-disable-next-line
        var loaderData = undefined as D;
      }

      // Compute action paths
      const actionPaths = computeActionPaths(
        route,
        rawRouteParams as Record<string, string>,
      );

      // Build route data with loaderPath that preserves search params
      const basePath = substituteParams(
        route.path,
        rawRouteParams as Record<string, string>,
      );
      const loaderSearch = new URLSearchParams(rawSearchParams);
      loaderSearch.delete("_data"); // remove if already present from data request
      loaderSearch.set("_data", "1");
      const routeData: RouteDataService = {
        data: loaderData,
        loaderPath: `${basePath}?${loaderSearch.toString()}`,
        actions: actionPaths,
      };

      if (isDataRequest) {
        // Return JSON for data requests (client-side navigation)
        return yield* HttpServerResponse.json(routeData).pipe(
          Effect.catchTag("HttpBodyError", () =>
            Effect.succeed(
              HttpServerResponse.text("Failed to serialize route data", {
                status: 500,
              }),
            ),
          ),
        );
      }

      // SSR: Render the component with data provided

      // Navigation layer for this request
      const navLayer = Navigation.makeLayer(router, {
        initialPath: url.pathname,
        initialSearch: url.search,
      });

      // Server-side RouteDataProvider that returns pre-computed data
      const routeDataProviderLayer = Layer.succeed(RouteDataProvider, {
        getRouteData: () => Effect.succeed(routeData),
      });

      // SSR AsyncCache — entries are scoped to this request
      const asyncCacheLayer = Layer.succeed(AsyncCache, makeAsyncCache());

      // Per-request `IdGenerator` — counter starts at zero for every
      // SSR render so `UniqueId.make`'s output is deterministic across
      // requests AND matches the counter the client's `hydrate` builds
      // (also starts at zero). See #173.
      const idGeneratorLayer = makeIdGeneratorLayer();

      // Render to string
      let html: string;

      if (options?.app) {
        // Render the full app component (same tree client hydrates).
        // Outlet inside the app will use the RouteDataProvider to get
        // pre-computed data — no double-loading.
        html = yield* render(options.app()).pipe(
          Effect.provide(
            Layer.mergeAll(
              navLayer,
              routeDataProviderLayer,
              asyncCacheLayer,
              idGeneratorLayer,
            ),
          ),
        );
      } else {
        // No app component — render just the matched route with layouts
        const element = route.render(loaderData).pipe(
          Effect.provideService(route.Params, {
            params: rawRouteParams as P,
            searchParams: rawSearchParams as S,
          }),
          Effect.provideService(RouteDataContext, routeData),
        );

        const withLayouts = router.layouts.reduce(
          (inner, wrapper) => wrapper(inner),
          element,
        );

        html = yield* render(withLayouts).pipe(
          Effect.provide(
            Layer.mergeAll(
              navLayer,
              routeDataProviderLayer,
              asyncCacheLayer,
              idGeneratorLayer,
            ),
          ),
        );
      }

      // Resolve route meta (title, description)
      const routeMetaResolved = resolveMeta(
        route as RouteType<string, unknown, unknown, unknown, unknown, unknown>,
        {
          params: rawRouteParams,
          searchParams: rawSearchParams,
          data: loaderData,
        },
      );

      // Embed loader data for hydration
      const hydrationData: Record<string, unknown> = {
        data: loaderData,
        actions: actionPaths,
      };

      return HttpServerResponse.html(
        generateDocument(
          html,
          hydrationData,
          options?.document,
          routeMetaResolved,
        ),
      );
    });

    // Register GET handler with error logging
    const debugHandler = catchRedirects(getHandler).pipe(
      Effect.catchAllCause((cause) =>
        Effect.gen(function* () {
          yield* Console.error(`[Platform] Error handling GET ${path}:`, cause);
          return HttpServerResponse.text(`Internal Server Error`, {
            status: 500,
          });
        }),
      ),
    );
    httpRouter = httpRouter.pipe(
      HttpRouter.get(
        path,
        debugHandler as unknown as HttpRouter.HttpRouter<never, never>,
      ),
    );

    // -------------------------------------------------------------------
    // Mutation handlers: POST/PUT/DELETE — direct execution, no render
    // -------------------------------------------------------------------
    const methodsUsed = new Set<string>();

    for (const handler of route._handlers) {
      // Only register one handler per HTTP method per route
      // (the handler dispatches by _action key)
      if (methodsUsed.has(handler.method)) continue;
      methodsUsed.add(handler.method);

      const mutationHandler = Effect.gen(function* () {
        const serverRequest = yield* HttpServerRequest.HttpServerRequest;
        const url = new URL(serverRequest.url, "http://localhost");
        const actionKey = url.searchParams.get("_action");

        if (!actionKey) {
          return HttpServerResponse.text("Missing ?_action parameter", {
            status: 400,
          });
        }

        // Find the handler matching the method and key
        const matchedHandler = route._handlers.find(
          (h) => h.method === handler.method && h.key === actionKey,
        );

        if (!matchedHandler) {
          return HttpServerResponse.text(
            `Action "${actionKey}" not found for ${handler.method.toUpperCase()}`,
            { status: 404 },
          );
        }

        // Parse request body: try JSON first, fall back to URL params
        const body: unknown = yield* serverRequest.json.pipe(
          Effect.catchAll(() =>
            serverRequest.urlParamsBody.pipe(
              Effect.map((params) => Object.fromEntries(params)),
            ),
          ),
          Effect.catchAll(() => Effect.succeed({})),
        );

        // Execute handler directly — no component rendering
        const result = yield* matchedHandler.handler(body);

        return yield* HttpServerResponse.json(result).pipe(
          Effect.catchTag("HttpBodyError", () =>
            Effect.succeed(
              HttpServerResponse.text("Failed to serialize action result", {
                status: 500,
              }),
            ),
          ),
        );
      });

      // Register on the appropriate HTTP method
      const wrappedHandler = catchRedirects(mutationHandler);
      if (handler.method === "post") {
        httpRouter = httpRouter.pipe(
          HttpRouter.post(
            path,
            wrappedHandler as unknown as HttpRouter.HttpRouter<never, never>,
          ),
        );
      } else if (handler.method === "put") {
        httpRouter = httpRouter.pipe(
          HttpRouter.put(
            path,
            wrappedHandler as unknown as HttpRouter.HttpRouter<never, never>,
          ),
        );
      } else if (handler.method === "delete") {
        httpRouter = httpRouter.pipe(
          HttpRouter.del(
            path,
            wrappedHandler as unknown as HttpRouter.HttpRouter<never, never>,
          ),
        );
      }
    }
  }

  return httpRouter as unknown as HttpRouter.HttpRouter<
    RedirectError | RouteNotFound,
    Exclude<
      R,
      | RouteDataContext
      | RouteDataProvider
      | NavigationContext
      | RendererContext
      | ControlCtx
      | SuspenseBoundaryCtx
      | Scope.Scope
    >
  >;
};

// =============================================================================
// Client Layer
// =============================================================================

declare const window: Window & {
  __STAX_DATA__?: Record<string, unknown>;
};

/**
 * Create a client-side Layer that provides NavigationContext and RouteDataProvider.
 *
 * On the first call (hydration), reads data from `window.__STAX_DATA__`.
 * On subsequent calls (client-side navigation), fetches from the server
 * via `?_data=1`.
 *
 * @example
 * ```ts
 * import { hydrate } from "@stax-ui/dom"
 * import { Platform } from "@stax-ui/platform"
 * import { router } from "./routes"
 *
 * const program = Effect.gen(function* () {
 *   yield* hydrate(App(), document.getElementById("root")!, {
 *     layer: Platform.makeClientLayer(router),
 *   })
 * })
 *
 * Effect.runPromise(Effect.scoped(program))
 * ```
 */
/**
 * Extract embedded `window.__STAX_DATA__` from a page's HTML.
 *
 * SSG deploys serve the same HTML for `<path>` and `<path>?_data=1`, so when
 * `makeClientLayer`'s data fetch gets HTML back, we scan for the loader-data
 * `<script>` tag emitted by {@link generateLoaderDataScript}. The JSON inside
 * uses \\uXXXX escapes for script-breaking characters (see {@link serializeForHtml}),
 * which JSON.parse handles natively.
 */
const extractEmbeddedRouteData = (html: string): unknown => {
  const match = html.match(
    /<script[^>]*>\s*window\.__STAX_DATA__\s*=\s*(.+?)\s*<\/script>/s,
  );
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
};

const isJsonContentType = (response: Response): boolean =>
  (response.headers.get("content-type") ?? "").toLowerCase().includes("json");

export const makeClientLayer = <
  P extends Record<string, unknown> | never,
  S extends Record<string, unknown> | never,
  D,
  E,
  R,
>(
  router: StaxRouter<P, S, D, E, R>,
): Layer.Layer<NavigationContext | RouteDataProvider, never, never> => {
  const dataProviderLayer = Layer.scoped(
    RouteDataProvider,
    Effect.gen(function* () {
      // Track whether this is the first data request (hydration)
      const isFirstLoad = yield* Ref.make(true);

      const provider: RouteDataProviderService = {
        getRouteData: (route, params, searchParams) =>
          Effect.gen(function* () {
            const first = yield* Ref.get(isFirstLoad);

            if (first) {
              yield* Ref.set(isFirstLoad, false);

              // Hydration: read embedded data from SSR
              const embedded =
                typeof window !== "undefined"
                  ? window.__STAX_DATA__
                  : undefined;

              if (embedded) {
                return embedded as unknown as RouteDataService;
              }
            }

            // Client navigation: fetch data for the target path.
            //
            // On an SSR server this hits the `?_data=1` handler and returns
            // JSON. On a static host (SSG output on any file server) the
            // query string is ignored and the same page HTML comes back — we
            // fall back to extracting the embedded `window.__STAX_DATA__`
            // from the HTML shell. Both modes look the same to callers.
            const path = substituteParams(route.path, params);
            const qs = new URLSearchParams(searchParams);
            qs.set("_data", "1");
            const response = yield* Effect.tryPromise(() =>
              fetch(`${path}?${qs.toString()}`),
            );

            if (isJsonContentType(response)) {
              const json = yield* Effect.tryPromise(() => response.json());
              // Pass through as-is — if it's a redirect signal
              // ({ _redirect: url }), the Outlet handles it via nav.pushPath
              return json as unknown as RouteDataService;
            }

            // Static fallback: extract from the served HTML shell. The
            // embedded blob has shape `{ data, actions }` (see buildStaticSite's
            // hydrationData construction); we pass it through unchanged after
            // adding a synthetic loaderPath.
            const html = yield* Effect.tryPromise(() => response.text());
            const embeddedBlob = extractEmbeddedRouteData(html) as
              { data: unknown; actions?: Record<string, unknown> } | undefined;
            if (embeddedBlob === undefined) {
              // Static host served HTML but we couldn't find the data blob.
              // Not fatal — some routes may legitimately have no loader data
              // — but log it so a broken build/deploy doesn't sit invisible.
              yield* Console.warn(
                `[@stax-ui/platform] Fetched HTML for ${path} but couldn't find window.__STAX_DATA__. ` +
                  `Continuing with data: undefined.`,
              );
            }
            const loaderPath = `${path}?${qs.toString()}`;
            return {
              data: embeddedBlob?.data,
              loaderPath,
              actions: embeddedBlob?.actions ?? {},
            } as unknown as RouteDataService;
          }).pipe(
            // Log before Effect.orDie so a failed fetch/parse doesn't become
            // an invisible blank Outlet. Effect's Console goes through a
            // service (swappable via Layer for tests); default sink is
            // browser console, so error trackers still see it.
            Effect.tapError((err) =>
              Console.error(
                `[@stax-ui/platform] Failed to load route data for ${substituteParams(route.path, params)}. ` +
                  `Outlet will render empty.`,
                err,
              ),
            ),
            Effect.orDie,
          ),
      };

      return provider;
    }),
  );

  const navLayer = Navigation.makeLayer(router);

  return Layer.mergeAll(navLayer, dataProviderLayer);
};

// =============================================================================
// Static Site Generation
// =============================================================================

export interface BuildStaticSiteOptions {
  /** The router containing routes to build */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly router: StaxRouter<any, any, any, any, any>;
  /**
   * Root app component. If provided, each page renders through this
   * (same component tree the client would hydrate).
   */
  readonly app?: () => import("@stax-ui/dom").Element.Element<
    HTMLElement | SVGElement,
    never,
    never
  >;
  /** Document generation options (title, scripts, styles) */
  readonly document?: DocumentOptions;
  /** Output directory for generated files */
  readonly outDir: string;
  /**
   * Additional layers to provide to loaders and render functions.
   * Use this for services like filesystem, markdown parsers, etc.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly layers?: Layer.Layer<any, never, never>;
}

interface StaticPage {
  readonly url: string;
  readonly html: string;
}

/**
 * Build a static site from a router's `Route.static` routes.
 *
 * Enumerates all static routes, runs their loaders, renders to HTML,
 * and writes the output to `outDir`.
 *
 * @example
 * ```ts
 * await Platform.buildStaticSite({
 *   router,
 *   app: App,
 *   document: {
 *     title: "My Docs",
 *     scripts: ["/assets/client.js"],
 *     styles: ["/assets/styles.css"],
 *   },
 *   outDir: "dist",
 *   layers: Layer.mergeAll(FileSystemLive, MarkdownServiceLive),
 * });
 * ```
 */
export const buildStaticSite = (
  options: BuildStaticSiteOptions,
): Promise<void> => {
  const { router, outDir } = options;
  const render = renderToString as (
    element: unknown,
  ) => Effect.Effect<string, unknown, unknown>;

  const program = Effect.gen(function* () {
    // Collect all pages to render
    const pages: Array<{
      url: string;
      route: RouteType<string, unknown, unknown, unknown, unknown, unknown>;
      params: Record<string, string>;
    }> = [];

    for (const route of router.routes) {
      const staticConfig = route._staticConfig;
      if (!staticConfig) continue;

      // Get all param sets for this route
      const paramSets: unknown[] = yield* (
        staticConfig.paths as () => Effect.Effect<unknown[], unknown, unknown>
      )();

      for (const params of paramSets) {
        const url = substituteParams(
          route.path,
          params as Record<string, string>,
        );
        pages.push({
          url,
          route: route as unknown as RouteType<
            string,
            unknown,
            unknown,
            unknown,
            unknown,
            unknown
          >,
          params: params as Record<string, string>,
        });
      }
    }

    // Render all pages concurrently
    const rendered: StaticPage[] = yield* Effect.forEach(
      pages,
      (page) =>
        Effect.gen(function* () {
          const staticConfig = page.route._staticConfig;

          // Run the loader
          const data = yield* (
            staticConfig?.load as (args: {
              params: unknown;
            }) => Effect.Effect<unknown, unknown, unknown>
          )({
            params: page.params,
          });

          // Build route data for hydration
          const routeData: RouteDataService = {
            data,
            loaderPath: page.url,
            actions: {},
          };

          // Navigation layer for this page
          const navLayer = Navigation.makeLayer(router, {
            initialPath: page.url,
            initialSearch: "",
          });

          // RouteDataProvider that returns pre-computed data
          const routeDataProviderLayer = Layer.succeed(RouteDataProvider, {
            getRouteData: () => Effect.succeed(routeData),
          });

          // AsyncCache for SSR
          const asyncCacheLayer = Layer.succeed(AsyncCache, makeAsyncCache());

          // Per-page `IdGenerator` — counter restarts for each generated
          // page so SSG output is deterministic and matches the client's
          // `hydrate` which also starts at zero (#173).
          const idGeneratorLayer = makeIdGeneratorLayer();

          const ssrLayers = Layer.mergeAll(
            navLayer,
            routeDataProviderLayer,
            asyncCacheLayer,
            idGeneratorLayer,
          );

          // Render to HTML
          let html: string;
          if (options.app) {
            html = yield* render(options.app()).pipe(Effect.provide(ssrLayers));
          } else {
            const element = page.route.render(data);
            html = yield* render(element).pipe(Effect.provide(ssrLayers));
          }

          // Resolve route meta
          const pageMeta = resolveMeta(page.route, {
            params: page.params,
            searchParams: {},
            data,
          });

          // Wrap in document shell
          const hydrationData: Record<string, unknown> = {
            data,
            actions: {},
          };
          const fullHtml = generateDocument(
            html,
            hydrationData,
            options.document,
            pageMeta,
          );

          return { url: page.url, html: fullHtml } as StaticPage;
        }),
      { concurrency: 10 },
    );

    // Render 404 page from router fallback
    if (router.fallback) {
      const navLayer = Navigation.makeLayer(router, {
        initialPath: "/404",
        initialSearch: "",
      });
      const routeDataProviderLayer = Layer.succeed(RouteDataProvider, {
        getRouteData: () =>
          Effect.succeed({ data: undefined, loaderPath: "/404", actions: {} }),
      });
      const asyncCacheLayer = Layer.succeed(AsyncCache, makeAsyncCache());
      const idGeneratorLayer = makeIdGeneratorLayer();
      const ssrLayers = Layer.mergeAll(
        navLayer,
        routeDataProviderLayer,
        asyncCacheLayer,
        idGeneratorLayer,
      );

      let fallbackHtml: string;
      if (options.app) {
        fallbackHtml = yield* render(options.app()).pipe(
          Effect.provide(ssrLayers),
        );
      } else {
        fallbackHtml = yield* render(router.fallback()).pipe(
          Effect.provide(ssrLayers),
        );
      }

      const fullHtml = generateDocument(fallbackHtml, {}, options.document);
      rendered.push({ url: "/__404__", html: fullHtml });
    }

    // Write all files to disk. The `node:fs/promises` and `node:path`
    // imports are deferred to inside this closure (and this closure
    // only runs server-side) so bundlers can tree-shake them out of
    // client builds that reach into Platform.ts via the shared
    // namespace export. See #163.
    const [fs, path] = yield* Effect.promise(() =>
      Promise.all([import("node:fs/promises"), import("node:path")]),
    );

    yield* Effect.forEach(
      rendered,
      (page) =>
        Effect.promise(async () => {
          const filePath =
            page.url === "/__404__"
              ? path.join(outDir, "404.html")
              : page.url === "/" || page.url === ""
                ? path.join(outDir, "index.html")
                : path.join(outDir, page.url, "index.html");

          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, page.html, "utf-8");
        }),
      { concurrency: 10 },
    );

    yield* Console.log(`[SSG] Built ${rendered.length} pages to ${outDir}`);
  });

  // Run the program with user-provided layers
  const withLayers = options.layers
    ? Effect.provide(program, options.layers)
    : program;

  return Effect.runPromise(withLayers as Effect.Effect<void>);
};

// =============================================================================
// Namespace
// =============================================================================

/**
 * Platform utilities namespace.
 */
export const Platform = {
  serializeForHtml,
  generateLoaderDataScript,
  generateDocument,
  toHttpRoutes,
  makeClientLayer,
  buildStaticSite,
};

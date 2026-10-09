/**
 * App composition — shared by the dev server and the prod Node adapter.
 *
 * `makeApp` returns an `HttpRouter` wrapping the Stax SSR routes.
 * Add API routes, middleware, and any other Effect `HttpRouter`
 * composition here. The adapter (dev plugin or Node adapter) calls
 * `makeApp` with environment-specific URL values.
 *
 * `AppLayer` (optional) provides any Effect services your handlers
 * need — database, auth, config, etc. The adapter provides it at
 * server scope.
 */

import { HttpRouter } from "@effect/platform";

import { Platform, type AppOptions } from "@stax-ui/platform";

import { App } from "./App.js";
import { router } from "./routes.js";

export const makeApp = (opts: AppOptions) =>
  HttpRouter.empty.pipe(
    HttpRouter.concat(
      Platform.toHttpRoutes(router, {
        app: App,
        document: {
          title: "Stax App",
          scripts: [...opts.scripts],
          styles: [...opts.styles],
        },
      }),
    ),
    // Add API routes and middleware here:
    // HttpRouter.concat(apiRoutes),
    // HttpRouter.use(authMiddleware),
  );

// Export an Effect Layer here to provide services your handlers
// need — e.g. database connections, config, auth. The adapter
// provides this at server scope. Set to `undefined` if your app
// has no services to provide.
//
// Example:
//   export const AppLayer = Layer.mergeAll(DatabaseLive, AuthLive);
export const AppLayer = undefined;

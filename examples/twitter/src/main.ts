/**
 * App composition — shared by the dev server and the prod Node adapter.
 *
 * Shows the full "backend alongside Stax" pattern:
 * - Stax SSR routes composed via `Platform.toHttpRoutes`
 * - A plain Effect HttpRouter API route (`/api/health`)
 * - A service layer (`PostServiceLive`) provided at server scope via
 *   `AppLayer`
 */

import { HttpRouter, HttpServerResponse } from "@effect/platform";
import { Layer } from "effect";

import { Platform, type AppOptions } from "@stax-ui/platform";

import { App } from "./App.js";
import { router } from "./routes.js";
import { PostService, PostServiceLive } from "./services/PostService.js";

export const makeApp = (opts: AppOptions) =>
  HttpRouter.empty.pipe(
    HttpRouter.concat(
      Platform.toHttpRoutes(router, {
        app: App,
        document: {
          title: "Twitter Demo",
          scripts: [...opts.scripts],
          styles: [...opts.styles],
        },
      }),
    ),
    // Plain Effect HttpRouter API route — composes alongside Stax routes.
    HttpRouter.get("/api/health", HttpServerResponse.json({ ok: true })),
  );

// Services provided at server scope. The Node adapter wraps the HttpApp
// with `Layer.provide(serverLive, AppLayer)` on the generated entry.
export const AppLayer = Layer.scoped(PostService, PostServiceLive);

/**
 * Production server.
 *
 * Serves the built client assets from `dist/`, and falls back to
 * Stax SSR rendering for anything that doesn't match a static file.
 */

import { createServer } from "node:http";
import * as path from "node:path";

import { HttpRouter, HttpServer } from "@effect/platform";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";

import { toHttpRoutes } from "@stax-ui/platform/server";

import { App } from "./App.js";
import { router } from "./routes.js";
import { serveStatic } from "./serveStatic.js";

const port = Number(process.env.PORT) || 3000;
const distDir = path.resolve(process.cwd(), "dist");

const staxRoutes = toHttpRoutes(router, {
  app: App,
  document: {
    title: "Stax App",
    scripts: ["/client.js"],
    styles: ["/styles.css"],
  },
});

const app = HttpRouter.empty.pipe(HttpRouter.concat(staxRoutes));

// Try to serve a static file; fall back to SSR when nothing matches.
const handler = serveStatic(distDir).pipe(Effect.orElse(() => app));

const ServerLive = HttpServer.serve(handler).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port })),
);

console.log(`Server running at http://localhost:${port}`);
NodeRuntime.runMain(Layer.launch(ServerLive));

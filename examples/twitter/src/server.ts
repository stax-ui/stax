import { createServer } from "node:http";

import { HttpRouter, HttpServer, HttpServerResponse } from "@effect/platform";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Layer } from "effect";

import { toHttpRoutes } from "@stax-ui/platform/server";

import { App } from "./App.js";
import { router } from "./routes.js";
import { PostService, PostServiceLive } from "./services/PostService.js";

// Build stax HTTP routes from the router
const staxRoutes = toHttpRoutes(router, {
  app: App,
  document: {
    title: "Twitter Demo",
    // In dev, Vite proxies to us — client script is served by Vite
    scripts: ["http://localhost:3003/src/client.ts"],
  },
});

// Compose the full HTTP app
const app = HttpRouter.empty.pipe(
  HttpRouter.get("/api/health", HttpServerResponse.json({ ok: true })),
  HttpRouter.concat(staxRoutes),
);

const PostServiceLayer = Layer.scoped(PostService, PostServiceLive);

const ServerLive = app.pipe(
  HttpServer.serve(),
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3002 })),
  Layer.provide(PostServiceLayer),
);

console.log("Twitter demo running at http://localhost:3002");
NodeRuntime.runMain(Layer.launch(ServerLive));

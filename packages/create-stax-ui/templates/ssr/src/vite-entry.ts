/**
 * Vite SSR entry point.
 *
 * Exports a `render` function that the staxPlatform plugin's
 * dev server calls to handle incoming requests.
 */

import { HttpApp, HttpRouter } from "@effect/platform";

import { toHttpRoutes } from "@stax-ui/platform/server";

import { App } from "./App.js";
import { router } from "./routes.js";

const staxRoutes = toHttpRoutes(router, {
  app: App,
  document: {
    title: "Stax App",
    scripts: ["/src/client.ts"],
    styles: ["/styles.css"],
  },
});

const app = HttpRouter.empty.pipe(HttpRouter.concat(staxRoutes));

const handler = HttpApp.toWebHandler(app);

/**
 * Handle an incoming request and return the Response.
 */
export async function render(request: Request): Promise<Response> {
  return handler(request);
}

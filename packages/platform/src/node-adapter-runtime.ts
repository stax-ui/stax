/**
 * Runtime helpers imported by the Node adapter's generated SSR entry.
 *
 * This lives in its own sub-entry (`@stax-ui/platform/node-adapter/runtime`)
 * because the generated entry imports from a Node-only package — Vite's
 * client builds must not resolve this file. The sub-entry acts as a
 * firewall: anything in here can freely use `node:*` modules.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { HttpServerRequest, HttpServerResponse } from "@effect/platform";
import { Effect } from "effect";

const MIME_TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain",
};

/**
 * Serve a static file from `distDir` matching the request path. Fails
 * with `"not-found"` when the file is missing so the caller can
 * `Effect.orElse` into the Stax app's SSR handler.
 *
 * Rejects paths that escape `distDir` via `..` traversal with
 * `"forbidden"`.
 */
export const serveStatic = (distDir: string) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = new URL(request.url, "http://localhost");
    const filePath = path.join(distDir, url.pathname);

    const resolvedDistDir = path.resolve(distDir);
    const resolvedFilePath = path.resolve(filePath);
    if (!resolvedFilePath.startsWith(resolvedDistDir)) {
      return yield* Effect.fail("forbidden" as const);
    }

    if (
      !fs.existsSync(resolvedFilePath) ||
      fs.statSync(resolvedFilePath).isDirectory()
    ) {
      return yield* Effect.fail("not-found" as const);
    }

    const mimeType =
      MIME_TYPES[path.extname(resolvedFilePath).toLowerCase()] ??
      "application/octet-stream";

    return HttpServerResponse.raw(fs.readFileSync(resolvedFilePath), {
      headers: { "content-type": mimeType },
    });
  });

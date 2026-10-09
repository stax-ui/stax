import * as fs from "node:fs";
import * as path from "node:path";

import type { Plugin, ViteDevServer } from "vite";

import type { StaxAdapter } from "@stax-ui/platform/node-adapter";

export {
  nodeAdapter,
  type NodeAdapterOptions,
} from "@stax-ui/platform/node-adapter";
export {
  ssgAdapter,
  type SsgAdapterOptions,
} from "@stax-ui/platform/ssg-adapter";
export type {
  StaxAdapter,
  SsrEntryContext,
} from "@stax-ui/platform/node-adapter";

/**
 * Options for the Stax Platform Vite plugin.
 *
 * Two config shapes supported:
 *
 * ## New shape — framework-owned lifecycle (recommended)
 *
 * Pass `app`, `client`, and `adapter`. The plugin owns both dev and prod
 * HTTP server lifecycles. The user writes `src/app.ts` exporting a
 * `makeApp({ scripts, styles })` factory and optional `AppLayer`.
 *
 * ```ts
 * staxPlatform({
 *   app: "src/app.ts",
 *   client: "src/client.ts",
 *   adapter: nodeAdapter({ port: 3000 }),
 * });
 * ```
 *
 * See issue #169 for the architecture.
 *
 * ## Legacy shape — user-owned lifecycle (deprecated)
 *
 * Pass `entry`. Keeps the current behavior where the user writes
 * `src/vite-entry.ts` (dev) + `src/server.ts` (prod) and the plugin
 * drives dev-mode SSR via a `render(request)` export. SSG mode
 * (`mode: "ssg"`) also uses this shape. Emits a deprecation warning on
 * dev startup; will be removed in a future minor.
 */
export interface StaxPlatformOptions {
  // =====================================================================
  // New shape
  // =====================================================================

  /**
   * Path to the user's app module. Must export:
   * - `makeApp(opts: { scripts: readonly string[]; styles: readonly string[] }): HttpRouter`
   * - optionally `AppLayer: Layer<unknown, unknown, unknown>`
   *
   * The plugin loads this module via Vite's SSR loader in dev, and
   * bundles it as the server-side input in prod.
   *
   * @example "src/app.ts"
   */
  readonly app?: string;

  /**
   * Path to the user's client entry module. Used as the Rollup input
   * for the client bundle, which lands at `dist/client/client.js`.
   *
   * @example "src/client.ts"
   */
  readonly client?: string;

  /**
   * The deploy-target adapter. Chooses how `vite build --ssr` emits the
   * server bundle: `nodeAdapter()` for a Node HTTP server, `ssgAdapter()`
   * for static site generation (follow-up PR), etc.
   */
  readonly adapter?: StaxAdapter;

  // =====================================================================
  // Legacy shape
  // =====================================================================

  /**
   * **Deprecated** — use `app` + `client` + `adapter` instead.
   *
   * Path to the SSR/SSG entry module.
   *
   * In SSR mode: exports a `render(request: Request) => Promise<Response>` function.
   * In SSG mode: exports `{ router, app?, document?, layers? }` for static site generation.
   */
  readonly entry?: string;
  /**
   * **Deprecated — only honored with legacy `entry` config.**
   *
   * Build mode.
   *
   * - `"ssr"` (default) — Standard SSR with live server
   * - `"ssg"` — Static site generation. After `vite build`, runs
   *   `Platform.buildStaticSite()` to pre-render all `Route.static` routes.
   */
  readonly mode?: "ssr" | "ssg";

  // =====================================================================
  // Shared
  // =====================================================================

  /**
   * File patterns to apply the server-code stripping transform to.
   * Defaults to all .ts/.tsx/.js/.jsx files.
   */
  readonly include?: RegExp;
  /**
   * File patterns to exclude from the transform.
   */
  readonly exclude?: RegExp;
}

/**
 * Vite plugin for @stax-ui/platform SSR applications.
 *
 * Provides two capabilities:
 *
 * 1. **Server-code stripping** (build time) — Removes loader and handler function
 *    bodies from client builds so server-only dependencies (database services, etc.)
 *    don't get bundled into the client.
 *    - `Route.get(loader, render)` → `Route.get(null, render)`
 *    - `Route.post("key", handler)` → `Route.post("key", () => { throw ... })`
 *
 * 2. **SSR dev server** (dev mode, when `entry` is provided) — Intercepts requests,
 *    renders pages via `vite.ssrLoadModule`, and injects Vite's HMR client.
 *
 * Only needed when using @stax-ui/platform for SSR. Pure SPAs that run loaders
 * client-side should NOT use this plugin.
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from "vite";
 * import { staxPlatform } from "@stax-ui/vite-plugin";
 *
 * export default defineConfig({
 *   plugins: [
 *     staxPlatform({ entry: "src/server-entry.ts" }),
 *   ],
 * });
 * ```
 */
// Virtual module ID the plugin uses as the SSR build's input when the
// new-shape config (app + adapter) is active. The `\0` prefix marks it
// as a Rollup-virtual id so other plugins / Vite's resolver don't fight
// over it.
const SSR_ENTRY_ID = "virtual:@stax-ui/platform/ssr-entry";
const RESOLVED_SSR_ENTRY_ID = "\0" + SSR_ENTRY_ID;

const isNewShape = (opts: StaxPlatformOptions): boolean =>
  opts.app !== undefined &&
  opts.client !== undefined &&
  opts.adapter !== undefined;

export const staxPlatform = (options: StaxPlatformOptions = {}): Plugin => {
  const include = options.include ?? /\.(tsx?|jsx?)$/;
  const exclude = options.exclude;
  const mode = options.mode ?? "ssr";
  const newShape = isNewShape(options);
  let isSsr = false;
  let isDev = false;
  let root: string;
  let outDir: string;
  let entryPath: string | null = null;
  // New-shape resolved paths
  let appPath: string | null = null;
  let clientPath: string | null = null;

  // Validate — if any new-shape key is set but not all three, that's a
  // user error worth flagging immediately rather than falling through to
  // the legacy path.
  if (!newShape && (options.app || options.client || options.adapter)) {
    throw new Error(
      "[stax-platform] `app`, `client`, and `adapter` must be used together. Got: " +
        JSON.stringify({
          app: options.app ?? null,
          client: options.client ?? null,
          adapter: options.adapter ? options.adapter.name : null,
        }),
    );
  }

  return {
    name: "stax-platform",

    config(config) {
      // Prevent the SSR build from wiping the client build's output.
      // Also applies to the new shape — `vite build && vite build --ssr`
      // runs two commands, the second must not clear the first's output.
      if (config.build?.ssr) {
        if (newShape) {
          return {
            build: {
              emptyOutDir: false,
              outDir: "dist/server",
              rollupOptions: {
                input: SSR_ENTRY_ID,
                output: {
                  entryFileNames: "index.js",
                },
              },
              ssr:
                typeof config.build.ssr === "string" ? config.build.ssr : true,
            },
          };
        }
        return {
          build: {
            emptyOutDir: false,
          },
        };
      }

      // Client build. In the new shape, the user's `client` entry is the
      // Rollup input. The adapter contributes build-time preferences —
      // `nodeAdapter` wants a stable `client.js` at `dist/client/`;
      // `ssgAdapter` wants hashed assets at `dist/` + a manifest.
      if (newShape && !config.build?.ssr) {
        const cbo = options.adapter!.clientBuildOptions ?? {};
        const clientOutDir = cbo.outDir ?? "dist/client";
        // Only override Vite's default entryFileNames when the adapter
        // asks for a stable name (e.g. Node). SSG leaves it unset so
        // Vite emits hashed `assets/[name]-[hash].js` and writes them
        // into the manifest the SSG runtime reads.
        const output = cbo.entryFileNames
          ? { entryFileNames: cbo.entryFileNames }
          : undefined;
        return {
          build: {
            outDir: clientOutDir,
            manifest: cbo.manifest ?? false,
            rollupOptions: {
              input: options.client!,
              ...(output && { output }),
            },
          },
        };
      }
    },

    configResolved(config) {
      root = config.root;
      outDir = path.resolve(root, config.build?.outDir ?? "dist");
      isSsr = !!config.build?.ssr;
      isDev = config.command === "serve";
      if (options.entry) {
        entryPath = path.resolve(root, options.entry);
      }
      if (newShape) {
        appPath = path.resolve(root, options.app!);
        clientPath = path.resolve(root, options.client!);
      }

      // Legacy-config deprecation nudge. Only warn in dev to avoid noise
      // in CI build output.
      if (!newShape && options.entry && isDev) {
        console.warn(
          "[stax-platform] The `entry` config is deprecated. Use " +
            "`app` + `client` + `adapter` instead. See " +
            "https://github.com/stax-ui/stax/issues/169 for migration.",
        );
      }
    },

    // -------------------------------------------------------------------------
    // Virtual SSR entry (new shape only)
    // -------------------------------------------------------------------------

    resolveId(id) {
      if (!newShape) return;
      if (id === SSR_ENTRY_ID) return RESOLVED_SSR_ENTRY_ID;
    },

    load(id) {
      if (!newShape) return;
      if (id !== RESOLVED_SSR_ENTRY_ID) return;
      // Compute the relative path from the server bundle's dir
      // (always `<root>/dist/server/`) to the adapter's chosen client
      // outDir. Node: `dist/client` → `../client`. SSG: `dist` → `..`.
      const clientOutDir =
        options.adapter!.clientBuildOptions?.outDir ?? "dist/client";
      const clientRelativeDir = path.relative(
        path.resolve(root, "dist/server"),
        path.resolve(root, clientOutDir),
      );

      return options.adapter!.ssrEntryModule({
        appModuleId: appPath!,
        scripts: [],
        styles: [],
        clientRelativeDir: clientRelativeDir.replace(/\\/g, "/"),
      });
    },

    // -------------------------------------------------------------------------
    // Server-code stripping (client builds only)
    // -------------------------------------------------------------------------

    transform(code, id, options) {
      // Never strip server code in SSR builds or SSR-loaded modules (dev)
      if (isSsr || options?.ssr) return null;

      // Filter by include/exclude patterns
      if (!include.test(id)) return null;
      if (exclude && exclude.test(id)) return null;

      // Quick bail — only transform files that reference Route
      if (
        !code.includes("Route.get") &&
        !code.includes("Route.post") &&
        !code.includes("Route.put") &&
        !code.includes("Route.del") &&
        !code.includes("Route.static")
      ) {
        return null;
      }

      const transformed = stripServerCode(code);
      if (transformed === code) return null;

      return { code: transformed, map: null };
    },

    // -------------------------------------------------------------------------
    // SSR dev server
    // -------------------------------------------------------------------------

    configureServer(server: ViteDevServer) {
      // New shape — plugin owns composition. SSR-loads the user's
      // `src/app.ts`, calls `makeApp` with dev-shape URLs, mounts.
      if (newShape) {
        const appAbs = appPath!;
        const clientAbs = clientPath!;
        // Vite serves source files at `/src/...` by convention relative to
        // project root. The dev URL for the client entry is just the
        // root-relative path.
        const clientDevUrl =
          "/" + path.relative(root, clientAbs).replace(/\\/g, "/");

        return () => {
          server.middlewares.use(async (req, res, next) => {
            const url =
              (req as { originalUrl?: string }).originalUrl || req.url || "/";
            const normalizedUrl =
              url === "/" || url === "/index.html" ? "/" : url;

            if (
              url.startsWith("/@") ||
              url.startsWith("/__vite") ||
              url.startsWith("/node_modules/") ||
              url.startsWith("/src/") ||
              (url.includes(".") && !url.endsWith("/") && url !== "/index.html")
            ) {
              return next();
            }

            try {
              const [userApp, platformModule] = await Promise.all([
                server.ssrLoadModule(appAbs),
                server.ssrLoadModule("@effect/platform"),
              ]);

              if (typeof userApp.makeApp !== "function") {
                throw new Error(
                  `App module "${options.app}" must export a "makeApp(opts) => HttpApp" function.`,
                );
              }

              const HttpApp = platformModule.HttpApp;
              const Effect = (await server.ssrLoadModule("effect")).Effect;
              const Layer = (await server.ssrLoadModule("effect")).Layer;

              const app = userApp.makeApp({
                scripts: [clientDevUrl],
                styles: [],
              });

              const providedApp = userApp.AppLayer
                ? Effect.provide(app, Layer.mergeAll(userApp.AppLayer))
                : app;

              const handler = HttpApp.toWebHandler(providedApp);

              const protocol = "http";
              const host = req.headers.host || "localhost";
              const webUrl = new URL(normalizedUrl, `${protocol}://${host}`);

              let body: string | undefined;
              if (req.method !== "GET" && req.method !== "HEAD") {
                body = await new Promise<string>((resolve) => {
                  let data = "";
                  req.on("data", (chunk: string) => (data += chunk));
                  req.on("end", () => resolve(data));
                });
              }

              const webRequest = new Request(webUrl.href, {
                method: req.method,
                headers: Object.entries(req.headers).reduce(
                  (acc, [key, value]) => {
                    if (value)
                      acc[key] = Array.isArray(value)
                        ? value.join(", ")
                        : value;
                    return acc;
                  },
                  {} as Record<string, string>,
                ),
                body,
              });

              const response: Response = await handler(webRequest);

              res.statusCode = response.status;
              response.headers.forEach((value, key) => {
                res.setHeader(key, value);
              });

              const responseBody = await response.text();
              const contentType = response.headers.get("content-type") || "";

              if (contentType.includes("text/html")) {
                const transformedHtml = await server.transformIndexHtml(
                  normalizedUrl,
                  responseBody,
                );
                res.setHeader(
                  "content-length",
                  Buffer.byteLength(transformedHtml),
                );
                res.end(transformedHtml);
              } else {
                res.end(responseBody);
              }
            } catch (e) {
              server.ssrFixStacktrace(e as Error);
              console.error("[stax-platform] Dev-render error:", e);

              res.statusCode = 500;
              res.setHeader("Content-Type", "text/html");
              res.end(`
                <!DOCTYPE html>
                <html>
                  <head><title>SSR Error</title></head>
                  <body>
                    <h1>Server Error</h1>
                    <pre style="color: red; white-space: pre-wrap;">${escapeHtml((e as Error).stack || (e as Error).message)}</pre>
                  </body>
                </html>
              `);
            }
          });
        };
      }

      // Legacy shape — user owns composition via `render(request)` export.
      if (!entryPath) return;

      const entry = entryPath;

      // Return a function to run after Vite's internal middleware
      return () => {
        server.middlewares.use(async (req, res, next) => {
          // Use originalUrl to get the URL before Vite's historyFallback rewrites it
          const url =
            (req as { originalUrl?: string }).originalUrl || req.url || "/";

          // Normalize index.html to root path
          const normalizedUrl =
            url === "/" || url === "/index.html" ? "/" : url;

          // Skip Vite internal requests and static assets
          if (
            url.startsWith("/@") ||
            url.startsWith("/__vite") ||
            url.startsWith("/node_modules/") ||
            url.startsWith("/src/") ||
            (url.includes(".") && !url.endsWith("/") && url !== "/index.html")
          ) {
            return next();
          }

          try {
            // Load the server entry module with HMR
            const serverModule = await server.ssrLoadModule(entry);

            if (typeof serverModule.render !== "function") {
              throw new Error(
                `Server entry "${options.entry}" must export a "render(request: Request) => Promise<Response>" function`,
              );
            }

            // Create a Web Request from the Node request
            const protocol = "http";
            const host = req.headers.host || "localhost";
            const webUrl = new URL(normalizedUrl, `${protocol}://${host}`);

            // Handle request body for POST/PUT/etc
            let body: string | undefined;
            if (req.method !== "GET" && req.method !== "HEAD") {
              body = await new Promise<string>((resolve) => {
                let data = "";
                req.on("data", (chunk: string) => (data += chunk));
                req.on("end", () => resolve(data));
              });
            }

            const webRequest = new Request(webUrl.href, {
              method: req.method,
              headers: Object.entries(req.headers).reduce(
                (acc, [key, value]) => {
                  if (value)
                    acc[key] = Array.isArray(value) ? value.join(", ") : value;
                  return acc;
                },
                {} as Record<string, string>,
              ),
              body: body,
            });

            // Call the render function — returns a Web Response
            const response: Response = await serverModule.render(webRequest);

            // Forward status and headers
            res.statusCode = response.status;
            response.headers.forEach((value, key) => {
              res.setHeader(key, value);
            });

            const responseBody = await response.text();
            const contentType = response.headers.get("content-type") || "";

            // Inject Vite's HMR client into HTML responses
            if (contentType.includes("text/html")) {
              const transformedHtml = await server.transformIndexHtml(
                normalizedUrl,
                responseBody,
              );
              // Recalculate content-length since transformIndexHtml may inject scripts
              res.setHeader(
                "content-length",
                Buffer.byteLength(transformedHtml),
              );
              res.end(transformedHtml);
            } else {
              res.end(responseBody);
            }
          } catch (e) {
            server.ssrFixStacktrace(e as Error);
            console.error("[stax-platform] Error:", e);

            res.statusCode = 500;
            res.setHeader("Content-Type", "text/html");
            res.end(`
              <!DOCTYPE html>
              <html>
                <head><title>SSR Error</title></head>
                <body>
                  <h1>Server Error</h1>
                  <pre style="color: red; white-space: pre-wrap;">${escapeHtml((e as Error).stack || (e as Error).message)}</pre>
                </body>
              </html>
            `);
          }
        });
      };
    },

    // -------------------------------------------------------------------------
    // Post-build hook — new shape uses `adapter.afterSsrBuild`; legacy
    // falls through to the SSG `closeBundle` path below.
    // -------------------------------------------------------------------------

    async closeBundle() {
      // New shape: delegate to the adapter's post-SSR hook. For
      // `nodeAdapter` this is undefined (nothing to run at build time).
      // For `ssgAdapter`, it imports the emitted entry so its top-level
      // `await runSsgBuild(...)` executes.
      if (newShape && isSsr && !isDev && options.adapter?.afterSsrBuild) {
        const serverOutDir = path.resolve(root, outDir);
        const ssrEntryPath = path.resolve(serverOutDir, "index.js");
        const clientOutDir = path.resolve(
          root,
          options.adapter.clientBuildOptions?.outDir ?? "dist/client",
        );
        await options.adapter.afterSsrBuild({
          ssrEntryPath,
          projectRoot: root,
          clientOutDir,
          serverOutDir,
        });
        return;
      }

      // Legacy SSG path.
      if (mode !== "ssg" || !entryPath || !isSsr || isDev) return;

      try {
        // Dynamically import the built SSG entry.
        // The entry must export: { router, app?, document?, layers? }
        // Dynamic import — `@stax-ui/platform` is only used in SSG mode
        // at build time, so we don't want to pay the load cost for SPA
        // builds. It's a regular dep (installed for every vite-plugin
        // user) but only pulled into memory when actually needed.
        const platformModule = "@stax-ui/platform";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { buildStaticSite } = (await import(platformModule)) as any;

        // Import the built SSR entry from the output directory.
        // Vite's SSR build outputs `src/entry.ts` as `entry.js` in outDir.
        const entryBasename = path.basename(entryPath, path.extname(entryPath));
        const builtEntry = path.resolve(outDir, `${entryBasename}.js`);
        const entryModule = await import(/* @vite-ignore */ builtEntry);

        if (!entryModule.router) {
          throw new Error(
            `SSG entry "${options.entry}" must export a "router"`,
          );
        }

        // Read the client-built index.html to extract actual asset paths.
        // Vite processes scripts/styles and outputs hashed filenames —
        // we need those real paths instead of the source paths in document options.
        const clientHtmlPath = path.resolve(outDir, "index.html");
        const documentOptions = { ...entryModule.document };

        if (fs.existsSync(clientHtmlPath)) {
          const clientHtml = fs.readFileSync(clientHtmlPath, "utf-8");

          // Extract script src attributes from the Vite-processed HTML
          const scriptMatches = [
            ...clientHtml.matchAll(/<script[^>]+src="([^"]+)"[^>]*>/g),
          ];
          // Replace source paths with the real hashed asset paths.
          // If no scripts found in client HTML, keep the original (shouldn't happen).
          if (scriptMatches.length > 0) {
            documentOptions.scripts = scriptMatches.map(
              (m: RegExpMatchArray) => m[1],
            );
          }

          // Extract stylesheet href attributes.
          // Check both attribute orderings (rel before href, href before rel).
          const styleMatches = [
            ...clientHtml.matchAll(
              /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/g,
            ),
            ...clientHtml.matchAll(
              /<link[^>]+href="([^"]+)"[^>]+rel="stylesheet"[^>]*>/g,
            ),
          ];
          // Always override — if Vite bundled CSS into JS (e.g. Tailwind),
          // there are no stylesheet links and we should clear the source paths.
          documentOptions.styles = styleMatches.map(
            (m: RegExpMatchArray) => m[1],
          );
        }

        await buildStaticSite({
          router: entryModule.router,
          app: entryModule.app,
          document: documentOptions,
          outDir,
          layers: entryModule.layers,
        });
      } catch (e) {
        console.error("[stax-platform] SSG build failed:", e);
        throw e;
      }
    },
  };
};

// =============================================================================
// Server-code stripping internals
// =============================================================================

/**
 * Remove import declarations whose specifiers are no longer referenced
 * in the rest of the code. This prevents server-only modules from being
 * evaluated after their call sites have been stripped.
 *
 * Only removes named imports (e.g. `import { a, b } from "..."`) where
 * every imported name is unreferenced. Side-effect imports (`import "..."`)
 * and namespace imports (`import * as x`) are left alone.
 */
const stripDeadImports = (code: string): string => {
  const importRe = /^import\s+\{([^}]+)\}\s+from\s+["'][^"']+["'];?\s*$/gm;
  let result = code;

  const toRemove: { start: number; end: number }[] = [];
  let match: RegExpExecArray | null;

  importRe.lastIndex = 0;

  while ((match = importRe.exec(code)) !== null) {
    const specifiers = match[1]
      .split(",")
      .map((s) => {
        const trimmed = s.trim().replace(/^type\s+/, "");
        const asMatch = trimmed.match(/\S+\s+as\s+(\S+)/);
        return asMatch ? asMatch[1] : trimmed;
      })
      .filter((s) => s.length > 0);

    if (specifiers.length === 0) continue;

    const importStart = match.index;
    const importEnd = match.index + match[0].length;
    const codeWithout = code.slice(0, importStart) + code.slice(importEnd);

    const allDead = specifiers.every((name) => {
      // `\b` is a `\w`↔`\W` boundary — it doesn't recognize identifier
      // characters that aren't in `\w`, notably `$`. A `\b$\b` pattern
      // never matches a real `$.foo` call site (the `$` sits between
      // whitespace and `.`, both `\W`). Match with lookarounds that
      // treat the full JS identifier alphabet as one side.
      const re = new RegExp(
        `(?<![A-Za-z0-9_$])${escapeRegExp(name)}(?![A-Za-z0-9_$])`,
      );
      return !re.test(codeWithout);
    });

    if (allDead) {
      toRemove.push({ start: importStart, end: importEnd });
    }
  }

  for (let i = toRemove.length - 1; i >= 0; i--) {
    const { start, end } = toRemove[i];
    const actualEnd =
      end < result.length && result[end] === "\n" ? end + 1 : end;
    result = result.slice(0, start) + result.slice(actualEnd);
  }

  return result;
};

const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Strip server-only code from route definitions.
 *
 * Transforms:
 * - `Route.get(loaderFn, renderFn)` → `Route.get(null, renderFn)`
 * - `Route.post("key", handlerFn)` → `Route.post("key", () => { throw new Error("server only"); })`
 * - Same for Route.put and Route.del
 */
export const stripServerCode = (code: string): string => {
  let result = code;
  result = stripLoaders(result);
  result = stripHandlers(result);
  result = stripStaticConfig(result);
  result = stripDeadImports(result);
  return result;
};

/**
 * Replace the first argument (loader) in Route.get() calls with null.
 */
const stripLoaders = (code: string): string => {
  const pattern = /Route\.get\s*\(/g;
  let result = code;
  let match: RegExpExecArray | null;
  let offset = 0;

  pattern.lastIndex = 0;

  while ((match = pattern.exec(code)) !== null) {
    const callStart = match.index + offset;
    const argsStart = callStart + match[0].length;

    const firstArgEnd = findArgEnd(result, argsStart);
    if (firstArgEnd === -1) continue;

    const before = result.slice(0, argsStart);
    const after = result.slice(firstArgEnd);
    const replacement = "null";
    const oldLen = firstArgEnd - argsStart;
    result = before + replacement + after;
    offset += replacement.length - oldLen;

    pattern.lastIndex = match.index + match[0].length;
  }

  return result;
};

/**
 * Replace the handler function (second argument) in Route.post/put/del() calls with a no-op.
 * Keeps the key (first argument) since Outlet reads it to compute action paths.
 */
const stripHandlers = (code: string): string => {
  const pattern = /Route\.(post|put|del)\s*\(/g;
  let result = code;
  let match: RegExpExecArray | null;
  let offset = 0;

  pattern.lastIndex = 0;

  while ((match = pattern.exec(code)) !== null) {
    const callStart = match.index + offset;
    const argsStart = callStart + match[0].length;

    const firstArgEnd = findArgEnd(result, argsStart);
    if (firstArgEnd === -1) continue;

    let secondArgStart = firstArgEnd;
    while (
      secondArgStart < result.length &&
      /[\s,]/.test(result[secondArgStart])
    ) {
      secondArgStart++;
    }

    const secondArgEnd = findArgEnd(result, secondArgStart);
    if (secondArgEnd === -1) continue;

    const before = result.slice(0, secondArgStart);
    const after = result.slice(secondArgEnd);
    const replacement = '() => { throw new Error("server only"); }';
    const oldLen = secondArgEnd - secondArgStart;
    result = before + replacement + after;
    offset += replacement.length - oldLen;

    pattern.lastIndex = match.index + match[0].length;
  }

  return result;
};

/**
 * Strip `Route.static(config)` to `Route.render(config.render)` in client builds.
 * The `paths` and `load` functions are server-only (build-time), so the client
 * only needs the `render` function for hydration.
 *
 * Transforms:
 * - `Route.static({ paths: ..., load: ..., render: (data) => El(data) })`
 *   → `Route.render((data) => El(data))`
 * - `Route.static({ load: ..., render: (data) => El(data) })`
 *   → `Route.render((data) => El(data))`
 */
const stripStaticConfig = (code: string): string => {
  const pattern = /Route\.static\s*\(/g;
  let result = code;
  let match: RegExpExecArray | null;
  let offset = 0;

  pattern.lastIndex = 0;

  while ((match = pattern.exec(code)) !== null) {
    const callStart = match.index + offset;
    const argsStart = callStart + match[0].length;

    // Find the full config object argument
    const configEnd = findArgEnd(result, argsStart);
    if (configEnd === -1) continue;

    const configStr = result.slice(argsStart, configEnd);

    // Extract the render function value from the config object.
    // Look for `render:` or `render :` followed by the function value.
    const renderMatch = configStr.match(/\brender\s*:\s*/);
    if (!renderMatch || renderMatch.index === undefined) continue;

    const renderValueStart = renderMatch.index + renderMatch[0].length;
    const renderValueEnd = findArgEnd(configStr, renderValueStart);
    if (renderValueEnd === -1) continue;

    const renderFn = configStr.slice(renderValueStart, renderValueEnd).trim();

    // Replace `Route.static({ ..., render: <fn> })` with `Route.render(<fn>)`.
    // The client's RouteDataProvider fetches loader data via `?_data=1`, so
    // the render fn does receive real data at runtime — we just need Route
    // to pass its argument through. Route.render's wrapper does that (see
    // `packages/router/src/Route.ts`).
    const replacement = `Route.render(${renderFn})`;
    const fullCallEnd = configEnd + 1; // +1 for closing paren of Route.static(...)
    const before = result.slice(0, callStart);
    const after = result.slice(fullCallEnd);
    const oldLen = fullCallEnd - callStart;
    result = before + replacement + after;
    offset += replacement.length - oldLen;

    pattern.lastIndex = match.index + match[0].length;
  }

  return result;
};

/**
 * Find the end position of a single argument starting at `start`.
 * Handles nested parens, braces, brackets, template literals, and strings.
 * Returns the index right after the argument (at the comma or closing paren).
 */
const findArgEnd = (code: string, start: number): number => {
  let depth = 0;
  let i = start;

  while (i < code.length) {
    const ch = code[i];

    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(code, i);
      continue;
    }

    if (ch === "/" && code[i + 1] === "/") {
      i = code.indexOf("\n", i);
      if (i === -1) return -1;
      i++;
      continue;
    }

    if (ch === "/" && code[i + 1] === "*") {
      i = code.indexOf("*/", i);
      if (i === -1) return -1;
      i += 2;
      continue;
    }

    if (ch === "(" || ch === "{" || ch === "[") {
      depth++;
    } else if (ch === ")" || ch === "}" || ch === "]") {
      if (depth === 0) {
        return i;
      }
      depth--;
    } else if (ch === "," && depth === 0) {
      return i;
    }

    i++;
  }

  return -1;
};

/**
 * Skip past a string literal (single-quoted, double-quoted, or template).
 * Returns the index after the closing quote.
 */
const skipString = (code: string, start: number): number => {
  const quote = code[start];
  let i = start + 1;

  while (i < code.length) {
    const ch = code[i];

    if (ch === "\\") {
      i += 2;
      continue;
    }

    if (quote === "`" && ch === "$" && code[i + 1] === "{") {
      i += 2;
      let templateDepth = 1;
      while (i < code.length && templateDepth > 0) {
        if (code[i] === "{") templateDepth++;
        else if (code[i] === "}") templateDepth--;
        else if (code[i] === '"' || code[i] === "'" || code[i] === "`") {
          i = skipString(code, i);
          continue;
        }
        i++;
      }
      continue;
    }

    if (ch === quote) {
      return i + 1;
    }

    i++;
  }

  return i;
};

// =============================================================================
// Utilities
// =============================================================================

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

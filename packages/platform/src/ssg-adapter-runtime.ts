/**
 * Runtime helper for the SSG adapter. Imported by the generated SSG
 * entry; executed once at build time inside the SSR Rollup output.
 *
 * `runSsgBuild` constructs the user's app via `makeApp`, resolves hashed
 * asset URLs from the Vite client manifest, iterates every
 * `Route.static` route, fires a synthetic GET request at each path, and
 * writes the response body as `index.html` under the matching directory.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { HttpApp } from "@effect/platform";
import { Effect, Layer } from "effect";

import type { AppOptions } from "./adapter.js";

export interface RunSsgBuildOptions {
  /** The user's `makeApp` factory. */
  readonly makeApp: (
    opts: AppOptions,
  ) => Effect.Effect<unknown, unknown, unknown>;
  /** The user's stax Router — needed to enumerate static routes. */
  readonly router: {
    readonly routes: ReadonlyArray<unknown>;
    readonly fallback?: unknown;
  };
  /** Optional service layer provided at server scope. */
  readonly appLayer: Layer.Layer<unknown, unknown, unknown> | undefined;
  /** Where HTML files land. Absolute path. */
  readonly outDir: string;
  /** Prod URLs for `document.scripts` — passed into `makeApp`. */
  readonly scripts: readonly string[];
  /** Prod URLs for `document.styles` — passed into `makeApp`. */
  readonly styles: readonly string[];
  /**
   * Where to look for the Vite client manifest (`.vite/manifest.json`).
   * Resolved relative to the generated entry's directory. If a manifest
   * exists, hashed script/style URLs are extracted from it and
   * REPLACE the configured `scripts`/`styles`. Otherwise the configured
   * values pass through unchanged.
   */
  readonly clientManifestRelativeDir: string;
}

const here = (): string => path.dirname(new URL(import.meta.url).pathname);

/**
 * Vite manifest shape (subset we care about). Vite 5+ writes this to
 * `<outDir>/.vite/manifest.json` when `build.manifest = true`.
 */
interface ViteManifest {
  readonly [sourcePath: string]: {
    readonly file: string;
    readonly css?: readonly string[];
    readonly isEntry?: boolean;
  };
}

const resolveFromManifest = async (
  manifestDir: string,
  fallbackScripts: readonly string[],
  fallbackStyles: readonly string[],
): Promise<{ scripts: readonly string[]; styles: readonly string[] }> => {
  const manifestPath = path.join(manifestDir, ".vite", "manifest.json");
  try {
    const raw = await fs.readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(raw) as ViteManifest;
    const entries = Object.values(manifest).filter((v) => v.isEntry);
    if (entries.length === 0) {
      return { scripts: fallbackScripts, styles: fallbackStyles };
    }
    const scripts = entries.map((e) => "/" + e.file);
    const styles = entries.flatMap((e) => (e.css ?? []).map((c) => "/" + c));
    return {
      scripts: scripts.length > 0 ? scripts : fallbackScripts,
      styles: styles.length > 0 ? styles : fallbackStyles,
    };
  } catch {
    // No manifest — fall back to configured values. Fine for simple
    // builds that don't opt into Vite's manifest emission.
    return { scripts: fallbackScripts, styles: fallbackStyles };
  }
};

interface StaxRoute {
  readonly path: string;
  readonly _staticConfig?: {
    readonly paths: () => Effect.Effect<readonly unknown[], unknown, unknown>;
  };
}

const substituteParams = (
  pathPattern: string,
  params: Record<string, string>,
): string => {
  let result = pathPattern;
  for (const [key, value] of Object.entries(params)) {
    if (key === "*") {
      // Catchall — replace the trailing `*` with the value (no URL
      // encoding; the slug may legitimately contain `/`).
      result = result.replace("*", value);
    } else {
      result = result.replace(`:${key}`, encodeURIComponent(value));
    }
  }
  return result;
};

const pageDir = (outDir: string, url: string): string =>
  url === "/" || url === "" ? outDir : path.join(outDir, url);

const writeHtml = async (
  outDir: string,
  url: string,
  html: string,
): Promise<void> => {
  const dir = pageDir(outDir, url);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "index.html"), html, "utf-8");
};

/**
 * Write the loader data as a sibling `_data.json` next to the page's
 * `index.html`. Client-side navigation (`makeClientLayer`'s
 * `RouteDataProvider`) fetches this file instead of relying on the
 * host to return JSON for `?_data=1` — static hosts typically ignore
 * query strings and serve the HTML, which the client would then have
 * to regex-extract. The sibling JSON is a stable, cacheable endpoint
 * that any file server returns verbatim.
 *
 * The JSON content comes from firing a synthetic `?_data=1` request
 * at the same handler the HTML pass used — the handler's existing
 * data-request branch already returns the right JSON shape, so we
 * don't have to parse out of the HTML or re-run the loader
 * ourselves.
 */
const writeDataJson = async (
  outDir: string,
  url: string,
  json: string,
): Promise<void> => {
  const dir = pageDir(outDir, url);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "_data.json"), json, "utf-8");
};

export const runSsgBuild = async (
  options: RunSsgBuildOptions,
): Promise<void> => {
  // Server bundle lives at `<projectRoot>/dist/server/index.js`, so walk
  // out two levels to reach the project root, then resolve the user's
  // outDir (default `"dist"`) from there.
  const projectRoot = path.resolve(here(), "..", "..");
  const outDirAbs = path.isAbsolute(options.outDir)
    ? options.outDir
    : path.resolve(projectRoot, options.outDir);
  const manifestDirAbs = path.resolve(
    here(),
    options.clientManifestRelativeDir,
  );

  const { scripts, styles } = await resolveFromManifest(
    manifestDirAbs,
    options.scripts,
    options.styles,
  );

  // Construct the app and wrap it as a web handler. `AppLayer` is
  // provided here so the SSG build has whatever services the user's
  // handlers need (e.g. file-system content, a mock database).
  const app = options.makeApp({ scripts, styles });

  const handler = options.appLayer
    ? HttpApp.toWebHandlerLayer(
        app as Parameters<typeof HttpApp.toWebHandlerLayer>[0],
        options.appLayer as Parameters<typeof HttpApp.toWebHandlerLayer>[1],
      ).handler
    : HttpApp.toWebHandler(app as Parameters<typeof HttpApp.toWebHandler>[0]);

  const routes = options.router.routes as readonly StaxRoute[];
  const pages: Array<{ url: string; html: string; data?: string }> = [];

  // Static routes — each one may expand to multiple pages via `paths()`.
  for (const route of routes) {
    const staticConfig = route._staticConfig;
    if (!staticConfig) continue;

    const paramSets = await Effect.runPromise(
      staticConfig.paths() as Effect.Effect<
        readonly Record<string, string>[],
        never,
        never
      >,
    );

    for (const params of paramSets) {
      const url = substituteParams(route.path, params);

      // HTML pass.
      const htmlResponse = await handler(new Request(`http://localhost${url}`));
      const html = await htmlResponse.text();

      // Data pass. The handler's `?_data=1` branch returns the loader
      // output as JSON — same shape as the colocated file we want to
      // emit. If the pass fails for any reason (route has no loader
      // and the handler 404s on data requests, say), we just skip the
      // JSON write for that page; the HTML still gets written and
      // client navigation falls back to the historical `?_data=1`
      // path on the live server.
      let data: string | undefined;
      try {
        const dataResponse = await handler(
          new Request(`http://localhost${url}?_data=1`),
        );
        if (
          dataResponse.ok &&
          (dataResponse.headers.get("content-type") ?? "")
            .toLowerCase()
            .includes("json")
        ) {
          data = await dataResponse.text();
        }
      } catch {
        // Non-fatal — fall through without writing JSON.
      }

      pages.push({ url, html, data });
    }
  }

  // Write all static pages to disk in parallel.
  await Promise.all(
    pages.flatMap((p) => [
      writeHtml(outDirAbs, p.url, p.html),
      p.data !== undefined
        ? writeDataJson(outDirAbs, p.url, p.data)
        : Promise.resolve(),
    ]),
  );

  // 404 page — fire a request at a URL that definitely won't match any
  // real route and let the router's fallback render it.
  if (options.router.fallback) {
    const response = await handler(
      new Request("http://localhost/__stax_ssg_404__"),
    );
    const html = await response.text();
    await fs.writeFile(path.join(outDirAbs, "404.html"), html, "utf-8");
  }

  console.log(
    `[SSG] Built ${pages.length} page${pages.length === 1 ? "" : "s"} to ${outDirAbs}`,
  );
};

/**
 * Options the adapter passes to the user's `makeApp(opts)` factory.
 * Imported in `src/main.ts` so the user's factory shape matches what
 * the plugin + adapter will supply at runtime.
 *
 * `scripts` and `styles` are URL-shape strings — the plugin fills in
 * dev-shape values (`/src/client.ts`) in `vite dev`; the adapter fills
 * in prod-shape values (`/client.js`) in the generated server bundle.
 */
export interface AppOptions {
  readonly scripts: readonly string[];
  readonly styles: readonly string[];
}

/**
 * The `StaxAdapter` contract. Adapters describe how a Stax app bundles
 * and runs in a specific deploy target (Node HTTP server, SSG, Vercel,
 * Cloudflare, etc.). The vite-plugin picks the adapter from the
 * user's `vite.config.ts` and delegates build-time + runtime hooks to it.
 *
 * This is a pure data contract — no runtime dependency on `@effect/platform`
 * or Node internals. The adapter *produces* source code strings that are
 * written to Vite's virtual module graph; those strings import from Effect
 * / Node / etc. at the user's level.
 */

/**
 * Context the plugin hands to an adapter at build time when asking it
 * to synthesize the SSR entry module.
 */
export interface SsrEntryContext {
  /**
   * The import specifier the adapter should use to pull in the user's
   * app module. This is a resolved specifier Vite will handle during
   * the SSR build — adapters embed it as `import * as userApp from "<ctx.appModuleId>"`.
   */
  readonly appModuleId: string;

  /**
   * Prod-shape URL(s) for the client script, to be passed to
   * `makeApp({ scripts: ... })` by the generated entry.
   */
  readonly scripts: readonly string[];

  /**
   * Prod-shape URL(s) for stylesheets, to be passed to
   * `makeApp({ styles: ... })` by the generated entry.
   */
  readonly styles: readonly string[];

  /**
   * Absolute path (resolved at runtime via `import.meta.url`) under which
   * the client bundle lives, relative to the generated SSR entry. Adapters
   * that serve static files set this up for `serveStatic` or equivalent.
   */
  readonly clientRelativeDir: string;
}

/**
 * Describes a deploy target for a Stax app.
 *
 * The adapter contributes code at build time via `ssrEntryModule`, which
 * returns a string of JavaScript the vite-plugin feeds into Vite's SSR
 * build as the entry. The resulting bundle is self-contained and
 * environment-specific (e.g. a Node HTTP server for `nodeAdapter`).
 */
export interface StaxAdapter {
  /** Short identifier for logs and diagnostics, e.g. `"node"`, `"ssg"`. */
  readonly name: string;

  /**
   * Synthesize the SSR entry's module source. Returns a complete
   * JavaScript module string the vite-plugin registers as a virtual
   * entry module.
   *
   * The returned module conventionally:
   * - imports the user's app namespace via `ctx.appModuleId` to get
   *   `makeApp` and optionally `AppLayer`;
   * - calls `makeApp({ scripts: ctx.scripts, styles: ctx.styles })`;
   * - wraps the resulting `HttpApp` with environment-specific bootstrap
   *   (static file serving, HTTP server, serverless handler, etc.);
   * - provides `userApp.AppLayer` if present.
   */
  readonly ssrEntryModule: (ctx: SsrEntryContext) => string;
}

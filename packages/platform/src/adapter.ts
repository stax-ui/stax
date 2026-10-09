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
 * Build-time preferences the adapter contributes to the client bundle
 * step. The plugin reads these and merges them into Vite's build config.
 *
 * None of the fields are required — defaults match the Node adapter's
 * convention (stable `client.js` at `dist/client/`), which the SSG
 * adapter overrides for its hashed-assets-at-dist/ layout.
 */
export interface ClientBuildOptions {
  /** Where the client bundle lands. Defaults to `"dist/client"`. */
  readonly outDir?: string;
  /**
   * Rollup `output.entryFileNames` pattern. Defaults to `"client.js"`
   * for the Node adapter (stable name the server bundle references).
   * SSG adapter leaves it unset so Vite uses its hashed default
   * (`assets/[name]-[hash].js`), paired with `manifest: true` so the
   * SSG runtime can resolve the hashed URL from `.vite/manifest.json`.
   */
  readonly entryFileNames?: string;
  /** Enable Vite's `.vite/manifest.json` emission. Defaults to `false`. */
  readonly manifest?: boolean;
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

  /**
   * Build-time preferences for the CLIENT bundle step. See
   * `ClientBuildOptions`. Leave unset to accept the Node-adapter
   * defaults.
   */
  readonly clientBuildOptions?: ClientBuildOptions;

  /**
   * Called by the plugin after the SSR build completes. Lets the
   * adapter run post-build work (e.g. SSG writing HTML files) when
   * the synthesized entry can't do everything inside the SSR bundle
   * itself. Optional — the Node adapter doesn't need this.
   */
  readonly afterSsrBuild?: (ctx: AfterSsrBuildContext) => Promise<void>;
}

/**
 * Context the plugin hands to `adapter.afterSsrBuild` after the SSR
 * build output is written to disk. The adapter may dynamically import
 * `ssrEntryPath` to execute whatever the synthesized module does at
 * build time (e.g. generate static HTML files).
 */
export interface AfterSsrBuildContext {
  /** Absolute path to the emitted SSR entry file. */
  readonly ssrEntryPath: string;
  /** Absolute path to the project root. */
  readonly projectRoot: string;
  /** Absolute path to the resolved client build output dir. */
  readonly clientOutDir: string;
  /** Absolute path to the resolved SSR build output dir. */
  readonly serverOutDir: string;
}

/**
 * Server-only entry point for `@stax-ui/platform`.
 *
 * Import from here in Node code (SSR server entries, SSG build
 * scripts, vite-plugin dev handlers). Everything here is safe to
 * reach `node:fs/promises`, `node:path`, and `@effect/platform-node`.
 *
 * ```ts
 * import { toHttpRoutes, buildStaticSite } from "@stax-ui/platform/server";
 * ```
 */

export {
  buildStaticSite,
  generateDocument,
  generateLoaderDataScript,
  RedirectError,
  serializeForHtml,
  toHttpRoutes,
  type BuildStaticSiteOptions,
  type DocumentOptions,
  type ToHttpRoutesOptions,
} from "./Platform.js";

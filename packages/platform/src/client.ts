/**
 * Client-only entry point for `@stax-ui/platform`.
 *
 * Import from here in browser code (hydrate entries, client bundles)
 * to avoid pulling in server-only surface (`toHttpRoutes`,
 * `buildStaticSite`, `generateDocument`) that references Node
 * built-ins and bloats the client bundle.
 *
 * ```ts
 * import { makeClientLayer } from "@stax-ui/platform/client";
 * ```
 */

export { makeClientLayer } from "./Platform.js";

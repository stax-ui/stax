/**
 * @stax-ui/vite-plugin
 *
 * Vite plugin for Stax Platform SSR applications.
 *
 * `staxPlatform()` provides:
 * - Server-code stripping from client builds (loaders + handlers)
 * - SSR dev server with HMR (when `entry` is provided)
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
 *
 * @packageDocumentation
 */

export {
  nodeAdapter,
  staxPlatform,
  type NodeAdapterOptions,
  type SsrEntryContext,
  type StaxAdapter,
  type StaxPlatformOptions,
} from "./plugin.js";

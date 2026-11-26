/**
 * Client-side mounting for Stax applications.
 *
 * @example
 * ```ts
 * import { mount } from "@stax-ui/dom/client";
 * import { App } from "./App";
 *
 * mount(App(), document.getElementById("root")!);
 * ```
 *
 * @module
 */

export { mount, mountScoped } from "./client.js";

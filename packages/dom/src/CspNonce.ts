/**
 * `CspNonce` — ambient per-request Content Security Policy nonce.
 *
 * When provided, element factories marked CSP-sensitive (built via
 * {@link enableCspNonce} — currently `$.script` and `$.style`) stamp
 * the nonce onto their generated attribute set, so each element is
 * on the response's `script-src 'nonce-…'` / `style-src 'nonce-…'`
 * allow-list.
 *
 * **Who provides this.**
 *
 * - `@stax-ui/platform`'s `toHttpRoutes` with the `csp` option
 *   generates a fresh nonce per request and provides this service
 *   into the SSR render scope.
 * - `hydrate` and `mount` auto-provide the service on the client when
 *   a `<meta property="csp-nonce" nonce="…">` tag is in the document.
 * - For client-only apps with no SSR, nothing provides it by default
 *   — add the meta tag yourself if you want strict CSP in that mode.
 *
 * **How consumers read it.** Always via `Effect.serviceOption(CspNonce)`
 * so the nonce is strictly optional. Yielding the tag directly would
 * force it into every element factory's `R` channel, which is wrong
 * for the vast majority of callers who never run under CSP.
 */

import { Context } from "effect";

export interface CspNonceService {
  readonly nonce: string;
}

export class CspNonce extends Context.Tag("@stax-ui/dom/CspNonce")<
  CspNonce,
  CspNonceService
>() {}

/**
 * Read the per-request CSP nonce the server embedded as
 * `<meta property="csp-nonce" nonce="…">`. Returns `null` when the
 * meta is absent (the overwhelmingly common case — no CSP configured
 * on this response), so `hydrate` / `mount` can skip providing the
 * `CspNonce` layer and keep the tag off every element factory's
 * required `R` channel.
 *
 * Browsers only "hide" the nonce attribute on CSP-governed elements
 * (script, style, link), not on meta — `getAttribute("nonce")` returns
 * the real value, no polyfill needed.
 */
export const readMetaNonce = (): string | null => {
  if (typeof document === "undefined") return null;
  const meta = document.querySelector('meta[property="csp-nonce"]');
  return meta?.getAttribute("nonce") ?? null;
};

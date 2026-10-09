/**
 * App composition — shared by the dev server and the prod SSG adapter.
 *
 * `makeApp` returns an `HttpRouter` wrapping the Stax SSR routes.
 * `AppLayer` provides the services the SSG build and the dev server
 * need (StorageNoOp here, since there's no real localStorage on the
 * server and SSG renders don't persist).
 *
 * `router` is re-exported so the SSG adapter can enumerate static
 * routes directly.
 */

import { HttpRouter } from "@effect/platform";

import { Platform, type AppOptions } from "@stax-ui/platform";

import { StorageNoOp } from "./components/TodoApp/index.js";
import { DocLayout } from "./layout.js";
import { router } from "./routes.js";

export { router };

// Site-wide description + OpenGraph / Twitter card metadata. Same
// tags on every route — enough for LinkedIn/Slack/Twitter/etc. to
// generate a preview when the site is shared. Per-route OG (each
// docs page carrying its own og:title/description/url) needs a
// framework-level extension of `RouteMeta`; tracked separately.
//
// `og:image` is an absolute URL because LinkedIn/Twitter crawlers
// don't resolve relative paths. `og-image.png` lives in
// `apps/docs/public/` and is expected to be 1200×630 (the size
// LinkedIn and Twitter render as a full-width hero card).
const SITE_URL = "https://stax-ui.dev";
const SITE_DESCRIPTION =
  "A reactive UI library ecosystem built on top of Effect.ts.";
const OG_IMAGE_URL = `${SITE_URL}/og-image.png`;

const headHtml = [
  // `<meta name="description">` is emitted per-route by
  // `generateDocument` from `Route.meta({ description })`, so it's
  // NOT set here — that would double-emit it on every route.
  // `og:description` stays site-wide until per-route OG lands.
  '<meta property="og:type" content="website">',
  '<meta property="og:site_name" content="Stax">',
  '<meta property="og:title" content="Stax | Reactive UI Built on Effect.ts">',
  `<meta property="og:description" content="${SITE_DESCRIPTION}">`,
  `<meta property="og:url" content="${SITE_URL}">`,
  `<meta property="og:image" content="${OG_IMAGE_URL}">`,
  '<meta property="og:image:width" content="1200">',
  '<meta property="og:image:height" content="630">',
  '<meta property="og:image:alt" content="Stax — reactive UI built on Effect.ts">',
  '<meta name="twitter:card" content="summary_large_image">',
  '<meta name="twitter:title" content="Stax | Reactive UI Built on Effect.ts">',
  `<meta name="twitter:description" content="${SITE_DESCRIPTION}">`,
  `<meta name="twitter:image" content="${OG_IMAGE_URL}">`,
  '<link rel="icon" type="image/x-icon" href="/favicon.ico">',
  '<link rel="icon" type="image/svg+xml" href="/favicon.svg">',
  '<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
  '<link rel="manifest" href="/site.webmanifest">',
  // Pre-paint theme resolution: read stored preference (if any),
  // else fall back to system `prefers-color-scheme`. Runs inline
  // during head parsing so `data-theme` is settled before the CSS
  // paints — no theme flash on first load.
  `<script>(function(){try{var s=localStorage.getItem('stax-theme');var t=(s==='dark'||s==='light')?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t)}catch(e){}})();</script>`,
  // Pre-paint storage snapshot: parse every `stax-*` key from
  // localStorage into a plain object on `window.__STAX_STORAGE__`.
  // `StorageLive` reads from this cache during hydration instead
  // of hitting localStorage directly — one JSON parse per key,
  // available synchronously before the client bundle boots.
  `<script>(function(){try{var d={};for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf('stax-')===0){try{d[k]=JSON.parse(localStorage.getItem(k))}catch(e){}}}window.__STAX_STORAGE__=d}catch(e){window.__STAX_STORAGE__={}}})();</script>`,
].join("\n    ");

export const makeApp = (opts: AppOptions) =>
  HttpRouter.empty.pipe(
    HttpRouter.concat(
      Platform.toHttpRoutes(router, {
        app: DocLayout,
        document: {
          title: "Stax Docs",
          scripts: [...opts.scripts],
          styles: [...opts.styles],
          htmlAttrs: { lang: "en" },
          head: headHtml,
        },
      }),
    ),
  );

// SSG-time + dev-time layer stack. `StorageNoOp` seeds every
// `Storage.persist` call with its defaults and drops writes on the
// floor — there's no real `localStorage` on the server, and
// pre-hydration renders wouldn't be persisting anyway.
export const AppLayer = StorageNoOp;

import { Effect, HashMap, Layer, Logger, LogLevel } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import { $, ClientControlCtx, DOMRendererLive } from "@stax-ui/dom";

import { Navigation } from "./Navigation.js";
import { Outlet } from "./Outlet.js";
import { Route } from "./Route.js";
import { RouteDataProvider } from "./RouteData.js";
import { concat, empty } from "./Router.js";

// Collect every logged message across the suite so tests can assert the
// framework emitted the right one. Records the subsystem annotation
// alongside the message so we can filter without depending on formatter.
interface CapturedLog {
  readonly level: string;
  readonly message: string;
  readonly subsystem: string | undefined;
}

const makeCapturingLogger = (
  sink: CapturedLog[],
): Layer.Layer<never, never, never> =>
  Logger.replace(
    Logger.defaultLogger,
    Logger.make((opts) => {
      const subsystem = HashMap.get(opts.annotations, "subsystem");
      sink.push({
        level: opts.logLevel.label,
        message: String(opts.message),
        subsystem:
          subsystem._tag === "Some" ? String(subsystem.value) : undefined,
      });
    }),
  );

const TestLayer = Layer.mergeAll(ClientControlCtx, DOMRendererLive);

describe("framework debug logs", () => {
  let logs: CapturedLog[];

  beforeEach(() => {
    document.body.innerHTML = "";
    logs = [];
  });

  const withDebug = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Logger.withMinimumLogLevel(LogLevel.Debug),
      Effect.provide(makeCapturingLogger(logs)),
    );

  it("emits an stax.nav log on pushPath with from/to", async () => {
    const HomeRoute = Route.make("/").pipe(
      Route.render(() => $.div({ class: "home" }, $.of("Home"))),
    );
    const AboutRoute = Route.make("/about").pipe(
      Route.render(() => $.div({ class: "about" }, $.of("About"))),
    );
    const router = empty.pipe(concat(HomeRoute), concat(AboutRoute));
    const navLayer = Navigation.makeLayer(router, { initialPath: "/" });

    await Effect.runPromise(
      withDebug(
        Effect.gen(function* () {
          const nav = yield* Navigation.Context;
          const outletEl = yield* Outlet({ router });
          document.body.appendChild(outletEl);
          yield* Effect.sleep("10 millis");
          yield* nav.pushPath("/about");
          yield* Effect.sleep("30 millis");
        }).pipe(
          Effect.scoped,
          Effect.provide(navLayer),
          Effect.provide(TestLayer),
        ),
      ),
    );

    const navLogs = logs.filter((l) => l.subsystem === "stax.nav");
    expect(navLogs.length).toBeGreaterThan(0);
    expect(navLogs.some((l) => l.message.includes("pushPath"))).toBe(true);
  });

  it("emits an stax.route-data log with the source that was chosen", async () => {
    // With a provider installed, the log should say "fetching route data via provider".
    const providerLayer = Layer.succeed(RouteDataProvider, {
      getRouteData: () =>
        Effect.succeed({
          data: { title: "Home" },
          loaderPath: "/?_data=1",
          actions: {},
        }),
    });

    const HomeRoute = Route.make("/").pipe(
      Route.static({
        load: () => Effect.succeed({ title: "Home" }),
        render: (data) => $.div({ class: "home" }, $.of(data.title)),
      }),
    );
    const router = empty.pipe(concat(HomeRoute));
    const navLayer = Navigation.makeLayer(router, { initialPath: "/" });

    await Effect.runPromise(
      withDebug(
        Effect.gen(function* () {
          yield* Outlet({ router });
          yield* Effect.sleep("10 millis");
        }).pipe(
          Effect.scoped,
          Effect.provide(navLayer),
          Effect.provide(providerLayer),
          Effect.provide(TestLayer),
        ),
      ),
    );

    const dataLogs = logs.filter((l) => l.subsystem === "stax.route-data");
    expect(dataLogs.length).toBeGreaterThan(0);
    expect(
      dataLogs.some((l) =>
        l.message.includes("fetching route data via provider"),
      ),
    ).toBe(true);
  });

  it("emits an stax.route-data log for the SPA fallback branch too", async () => {
    // No provider — the log should identify which branch was chosen.
    const HomeRoute = Route.make("/").pipe(
      Route.static({
        load: () => Effect.succeed({ title: "Home" }),
        render: (data) => $.div({ class: "home" }, $.of(data.title)),
      }),
    );
    const router = empty.pipe(concat(HomeRoute));
    const navLayer = Navigation.makeLayer(router, { initialPath: "/" });

    await Effect.runPromise(
      withDebug(
        Effect.gen(function* () {
          yield* Outlet({ router });
          yield* Effect.sleep("10 millis");
        }).pipe(
          Effect.scoped,
          Effect.provide(navLayer),
          Effect.provide(TestLayer),
        ),
      ),
    );

    const dataLogs = logs.filter((l) => l.subsystem === "stax.route-data");
    expect(dataLogs.length).toBeGreaterThan(0);
    expect(dataLogs.some((l) => l.message.includes("SPA fallback"))).toBe(true);
  });

  it("logs an stax.reconcile error when a route render fails and keeps the subscription alive", async () => {
    // The wrapping lives in core's `reconcile` — a failing render on
    // subsequent nav is logged at Error level with subsystem
    // "stax.reconcile" and the fiber survives so the next nav still
    // renders. Without this, one broken route freezes all future
    // updates. This exercises the wrapping through the whole stack:
    // Outlet → reconcile → ctx.subscribe → subscribeReconcile.
    const BoomRoute = Route.make("/boom").pipe(
      Route.render(() => Effect.fail(new Error("route render exploded"))),
    );
    const OKRoute = Route.make("/ok").pipe(
      Route.render(() => $.div({ class: "ok" }, $.of("OK"))),
    );
    const HomeRoute = Route.make("/").pipe(
      Route.render(() => $.div({ class: "home" }, $.of("Home"))),
    );
    const router = empty.pipe(
      concat(HomeRoute),
      concat(BoomRoute),
      concat(OKRoute),
    );
    const navLayer = Navigation.makeLayer(router, { initialPath: "/" });

    // No withMinimumLogLevel — Error logs are visible at every level, so
    // this exercises the "user sees the error without opting into debug"
    // guarantee.
    await Effect.runPromise(
      Effect.gen(function* () {
        const nav = yield* Navigation.Context;
        const outletEl = yield* Outlet({ router });
        document.body.appendChild(outletEl);
        yield* Effect.sleep("10 millis");
        yield* nav.pushPath("/boom"); // fails
        yield* Effect.sleep("20 millis");
        yield* nav.pushPath("/ok"); // must still render
        yield* Effect.sleep("20 millis");
      }).pipe(
        Effect.scoped,
        Effect.provide(navLayer),
        Effect.provide(makeCapturingLogger(logs)),
        Effect.provide(TestLayer),
      ),
    );

    const errorLogs = logs.filter(
      (l) => l.subsystem === "stax.reconcile" && l.level === "ERROR",
    );
    expect(errorLogs.length).toBeGreaterThan(0);
    expect(
      errorLogs.some((l) => l.message.includes("reconcile handler failed")),
    ).toBe(true);

    // The subscription survived — /ok rendered after the failure.
    expect(document.querySelector(".ok")?.textContent).toBe("OK");
  });

  it("Route.meta surfaces MetaRenderError on E for `catchTag` at the initial render", async () => {
    // Route.meta's input is a user-written function that reads off
    // `data` — if `data` is wrong-shape (e.g. SSG client-side nav
    // loading the wrong page's blob), the dereference throws. We
    // surface this as a typed `MetaRenderError` on the Route's E so
    // the caller can `.pipe(Effect.catchTag("MetaRenderError", ...))`
    // on Outlet's initial render and recover with a fallback.
    //
    // Subsequent navigation-driven syncs run on a forked subscription
    // fiber whose failures don't propagate to the caller — those stay
    // logged via `safeSync` so the subscription survives. The initial
    // sync IS catchable, which is where this test exercises.
    const BoomMetaRoute = Route.make("/").pipe(
      Route.render(() => $.div({ class: "home" }, $.of("Home"))),
      // Deliberately dereference an undefined field to throw during
      // meta resolution — mirrors the TypeError the docs-app saw on
      // /docs/introduction when data shape didn't match.
      Route.meta(({ data }) => ({
        title: (data as unknown as { nope: { title: string } }).nope.title,
      })),
    );
    const router = empty.pipe(concat(BoomMetaRoute));
    const navLayer = Navigation.makeLayer(router, { initialPath: "/" });

    let caughtRoute: string | null = null;

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* Outlet({ router }).pipe(
          Effect.catchTag("MetaRenderError", (e) =>
            Effect.sync(() => {
              caughtRoute = e.route;
              return document.createElement("div");
            }),
          ),
        );
      }).pipe(
        Effect.scoped,
        Effect.provide(navLayer),
        Effect.provide(makeCapturingLogger(logs)),
        Effect.provide(TestLayer),
      ),
    );

    expect(caughtRoute).toBe("/");
  });

  it("emits nothing at debug subsystems when the log level is above Debug", async () => {
    // Guards against accidentally logging at higher levels — users who
    // haven't opted in shouldn't see any of this noise.
    const HomeRoute = Route.make("/").pipe(
      Route.render(() => $.div({ class: "home" }, $.of("Home"))),
    );
    const AboutRoute = Route.make("/about").pipe(
      Route.render(() => $.div({ class: "about" }, $.of("About"))),
    );
    const router = empty.pipe(concat(HomeRoute), concat(AboutRoute));
    const navLayer = Navigation.makeLayer(router, { initialPath: "/" });

    await Effect.runPromise(
      Effect.gen(function* () {
        const nav = yield* Navigation.Context;
        const outletEl = yield* Outlet({ router });
        document.body.appendChild(outletEl);
        yield* Effect.sleep("10 millis");
        yield* nav.pushPath("/about");
        yield* Effect.sleep("30 millis");
      }).pipe(
        Effect.scoped,
        Effect.provide(navLayer),
        Effect.provide(makeCapturingLogger(logs)),
        // No Logger.withMinimumLogLevel — defaults to Info; Debug is filtered.
        Effect.provide(TestLayer),
      ),
    );

    const frameworkLogs = logs.filter((l) => l.subsystem?.startsWith("stax."));
    expect(frameworkLogs).toEqual([]);
  });
});

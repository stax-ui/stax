/**
 * Dist-types smoke test for `@stax-ui/dom`.
 *
 * Type-checked against the built `dist/` with `skipLibCheck: false` and
 * `strict`. If the emitted `.d.ts` reintroduces a function-namespace
 * merge that self-references (as happened in 0.12.0 with
 * `container.provides`, which resolved to the namespace member and
 * silently collapsed to `any` under `skipLibCheck: true` or errored as
 * TS2502 under `skipLibCheck: false`), one of the `IsAny` guards below
 * breaks the build.
 *
 * Any new function/namespace surface added to the public exports should
 * be exercised here, or the same bug class can regress.
 */

import { Context } from "effect";

import { container } from "@stax-ui/dom";

/**
 * `IsAny<T>` is `true` if `T` is `any`, else `false`.
 *
 * Idiom: `0 extends (1 & T)` holds only when `T` is `any`, since `1 & T`
 * collapses to `any` in that case and `0 extends any` is true. For any
 * other `T`, `1 & T` is `never` or narrower.
 *
 * Used here as an assertion idiom instead of the simpler
 * `NotAny<T> = 0 extends (1 & T) ? never : T` because an `any` value is
 * assignable to `never`, so `NotAny` fails to catch the bug.
 */
type IsAny<T> = 0 extends 1 & T ? true : false;

// Guard: `container` is a real callable, not `any`.
// Each assertion fails to compile if its subject is `any`.
const _containerIsAny: false = null as unknown as IsAny<typeof container>;
void _containerIsAny;

// Guard: `container.provides` is a real function, not `any`.
// This is the exact 0.12.0 regression.
const _providesIsAny: false = null as unknown as IsAny<
  typeof container.provides
>;
void _providesIsAny;

// Guard: `container.provides(Tag)` returns a real factory, not `any`.
class SmokeCtx extends Context.Tag("@stax-ui/dom/verify-dist/SmokeCtx")<
  SmokeCtx,
  { readonly v: number }
>() {}

const smokeFactory = container.provides(SmokeCtx);
const _factoryIsAny: false = null as unknown as IsAny<typeof smokeFactory>;
void _factoryIsAny;

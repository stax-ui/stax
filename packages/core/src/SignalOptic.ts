/**
 * Signal.Optic — one deeply-nested state root that hands out lazy,
 * fine-grained `Readable`s for arbitrary sub-paths.
 *
 * Motivation: `Signal.Struct` gives per-field signals but only one
 * level deep and only for a known key set. For deeply nested state
 * (config trees, form models, editor documents) you'd otherwise be
 * stuck either constructing nested Structs by hand or reading the
 * whole tree and mapping — both give up the "only the components who
 * read this field re-render" property that makes signals worth the
 * ceremony in the first place.
 *
 * Shape:
 *
 * ```ts
 * const state = yield* Signal.Optic.make({ a: { b: { c: 0 }, d: 1 }, e: 2 });
 *
 * const c = yield* Signal.Optic.get(state, "a.b.c");
 * const b = yield* Signal.Optic.get(state, "a.b");
 *
 * yield* Signal.Optic.set(state, "a.b.c", 3);
 * yield* c.get; // 3
 * yield* b.get; // { c: 3 }
 *
 * yield* Signal.Optic.set(state, "a.b", { c: 5 });
 * yield* b.get; // { c: 5 }
 * yield* c.get; // 5  ← ancestor write propagates to child readables
 * ```
 *
 * Arrays are addressed by numeric segments — `"items.0.name"` walks
 * into `state.items[0].name`. Writes preserve array-ness via
 * structural-sharing `slice()`; siblings at other indices keep
 * reference equality, so a subscriber to `"items.3.name"` doesn't fire
 * when `"items.0.name"` is written:
 *
 * ```ts
 * const state = yield* Signal.Optic.make({ items: [{ name: "a" }, { name: "b" }] });
 * const firstName = yield* Signal.Optic.get(state, "items.0.name");
 * yield* Signal.Optic.set(state, "items.0.name", "A");
 * yield* firstName.get; // "A"
 * ```
 *
 * The root handle itself is a `Readable<T>` (whole tree), so
 * `yield* state.get` works and so does `state.changes` for observing
 * every write. Direct `.set` on the root is intentionally NOT
 * provided — writes flow only through `Signal.Optic.set(state, path,
 * value)` / `Signal.Optic.update(state, path, fn)`. That's what
 * enables `Signal.trace`-style write-tracing to answer "which lens
 * modified this state?" without users having to grep for `.set(`
 * everywhere; every mutation carries a path.
 *
 * @module
 */

import {
  Data,
  Effect,
  Function as Fn,
  Option,
  Predicate,
  Scope,
  Stream,
  SubscriptionRef,
} from "effect";

import { Readable, TypeId as ReadableTypeId } from "./Readable.js";

// =============================================================================
// Errors
// =============================================================================

/**
 * Raised by `Signal.Optic.set` / `.update` when a numeric path segment
 * would write past the end of an array (index `> length`, or index
 * `< 0`).
 *
 * Index `=== length` is allowed — that's a legitimate append. Anything
 * beyond would silently create holes filled with `undefined`, which
 * violates the array element type; failing here surfaces the intent
 * mismatch instead of laundering it into a runtime shape bug.
 *
 * Use `Signal.Optic.setUnsafe` / `.updateUnsafe` to bypass the bounds
 * check (holes get created; you're on your own).
 */
export class OpticOutOfBoundsError extends Data.TaggedError(
  "OpticOutOfBoundsError",
)<{
  /** The dot-separated path segment where the write was rejected. */
  readonly path: string;
  /** The numeric index that was attempted. */
  readonly index: number;
  /** The array's length at the moment of the write (or 0 for a fresh array). */
  readonly length: number;
}> {}

// =============================================================================
// TypeId
// =============================================================================

export const OpticTypeId: unique symbol = Symbol.for("stax/Signal/Optic");
export type OpticTypeId = typeof OpticTypeId;

// =============================================================================
// Path types (template-literal)
// =============================================================================

// Depth-limited recursion keeps TS from choking on the type-level walk.
// Five levels covers the realistic ceiling for hand-authored state
// trees; beyond that either use the composable lens API (future) or
// widen a sub-path to a bare `Readable<unknown>` via cast.
type Prev = [never, 0, 1, 2, 3, 4, 5];

/**
 * All valid dot-separated paths into `T` — object keys or (for arrays)
 * numeric indices separated by `.`, terminating either at a primitive
 * leaf or at the maximum recursion depth. Non-object values ignore
 * recursion and only contribute their own segment.
 *
 * Arrays produce `` `${number}` `` segments (e.g. `"items.0.name"`).
 * For tuples this widens to the union of element types — precision is
 * traded for simpler types; if you need per-index precision, use a
 * union-narrowing check at the read site.
 */
// `NonNullable` stripping in the recursion lets `Paths` / `ValueAtPath`
// see through optional or nullable fields — a field declared
// `x?: { y: number }` still exposes `"x.y"` as a valid path. Without
// this, `T[K] extends object` on a distributive union that includes
// `undefined` collapses to `never` and the sub-paths disappear.
type NN<T> = NonNullable<T>;

export type Paths<T, D extends number = 5> = [D] extends [never]
  ? never
  : NN<T> extends readonly (infer E)[]
    ? NN<E> extends object
      ? `${number}` | `${number}.${Paths<NN<E>, Prev[D]>}`
      : `${number}`
    : NN<T> extends object
      ? {
          [K in keyof NN<T> & string]:
            | K
            | (NN<NN<T>[K]> extends object
                ? `${K}.${Paths<NN<NN<T>[K]>, Prev[D]>}`
                : never);
        }[keyof NN<T> & string]
      : never;

/**
 * The value type at a dot-separated path `P` in `T`. Numeric segments
 * project into arrays' element type. Nullable-through-a-field paths
 * strip `undefined` from intermediates; the terminal segment preserves
 * whatever nullability the field itself declares.
 */
export type ValueAtPath<T, P extends string> =
  NN<T> extends readonly (infer E)[]
    ? P extends `${number}`
      ? E
      : P extends `${number}.${infer Rest}`
        ? ValueAtPath<NN<E>, Rest>
        : never
    : P extends keyof NN<T>
      ? NN<T>[P]
      : P extends `${infer K}.${infer Rest}`
        ? K extends keyof NN<T>
          ? ValueAtPath<NN<NN<T>[K]>, Rest>
          : never
        : never;

// =============================================================================
// Model
// =============================================================================

/**
 * A `Signal.Optic<T>` is a `Readable<T>` of the whole tree plus an
 * opaque handle to its internal path-subscriber table. Callers can
 * observe the whole tree via `.get` / `.changes` / `.values`, but
 * writes flow through `Signal.Optic.set` / `Signal.Optic.update`
 * against a path.
 */
export interface Optic<T> extends Readable.Readable<T> {
  readonly [OpticTypeId]: OpticTypeId;
  /** @internal */
  readonly _ref: SubscriptionRef.SubscriptionRef<T>;
  /**
   * Path → set of subscriber callbacks. Every write invokes each
   * callback whose path overlaps the write, passing the new root; each
   * subscriber projects its own path off the root (via `getIn` for
   * `getUnsafe`, `getInOption` for `get`) and emits the projected
   * value. Passing root instead of a pre-projected value lets safe
   * and unsafe subscribers share one entry per path.
   * @internal
   */
  readonly _subs: Map<string, Set<(root: unknown) => void>>;
}

/**
 * @category guards
 */
export const isOptic = (value: unknown): value is Optic<unknown> =>
  Predicate.hasProperty(value, OpticTypeId);

// =============================================================================
// Construction
// =============================================================================

/**
 * Create a new `Optic` seeded with an initial value.
 */
export const make = <T>(
  initial: T,
): Effect.Effect<Optic<T>, never, Scope.Scope> =>
  Effect.gen(function* () {
    const ref = yield* SubscriptionRef.make(initial);
    const subs = new Map<string, Set<(root: unknown) => void>>();

    // Whole-tree Readable — `.changes` drops the first emission
    // because SubscriptionRef fires current-value on subscribe and our
    // Readable contract is future-only.
    const readable = Readable.make(SubscriptionRef.get(ref), () =>
      Stream.drop(ref.changes, 1),
    );

    return {
      [ReadableTypeId]: ReadableTypeId,
      [OpticTypeId]: OpticTypeId,
      get: readable.get,
      changes: readable.changes,
      values: readable.values,
      pipe: readable.pipe.bind(readable),
      _ref: ref,
      _subs: subs,
    } as Optic<T>;
  });

// =============================================================================
// Path arithmetic (runtime)
// =============================================================================

const parsePath = (path: string): readonly string[] =>
  path === "" ? [] : path.split(".");

const getIn = (root: unknown, keys: readonly string[]): unknown => {
  let cur: unknown = root;
  for (const k of keys) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
};

// Path-resolvability-aware read. Returns `None` if any segment along
// the way is missing — a missing key on an object, an out-of-bounds
// index on an array, or a primitive parent that can't be traversed
// further. If every segment resolves, wraps the terminal value in
// `Some` — even if the value itself is `undefined` (a legitimately-
// stored `undefined` is still a value that WAS reached).
const getInOption = (
  root: unknown,
  keys: readonly string[],
): Option.Option<unknown> => {
  let cur: unknown = root;
  for (const k of keys) {
    if (cur === null || cur === undefined) return Option.none();
    if (Array.isArray(cur)) {
      const idx = Number(k);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) {
        return Option.none();
      }
      cur = cur[idx];
      continue;
    }
    if (typeof cur === "object") {
      if (!(k in (cur as object))) return Option.none();
      cur = (cur as Record<string, unknown>)[k];
      continue;
    }
    return Option.none();
  }
  return Option.some(cur);
};

// Immutable set: rebuilds only the objects along `keys`; unaffected
// branches keep their previous references (structural sharing). That
// lets subscriber-side dedup rely on `Object.is` at the read path
// rather than deep-comparing every emission.
//
// Preserves array vs object shape: `["items", "0", "name"]` walks into
// an array via numeric index and rebuilds the array with `slice()` so
// the result is still an array (spreading into `{...arr}` would
// silently produce an object with numeric-string keys and drop
// `length`). If a numeric segment lands on a null / undefined parent,
// we default to `[]` — matches the "object default is `{}`" behavior
// on the other branch.
const setIn = (
  root: unknown,
  keys: readonly string[],
  value: unknown,
): unknown => {
  if (keys.length === 0) return value;
  const [head, ...rest] = keys;
  const isIndex = /^-?\d+$/.test(head);
  if (isIndex && (Array.isArray(root) || root === null || root === undefined)) {
    const idx = Number(head);
    const next = Array.isArray(root) ? root.slice() : [];
    next[idx] = setIn(next[idx], rest, value);
    return next;
  }
  const parent =
    root === null || root === undefined
      ? {}
      : (root as Record<string, unknown>);
  return { ...parent, [head]: setIn(parent[head], rest, value) };
};

// Bounds-checked variant. Fails with `OpticOutOfBoundsError` if a
// numeric segment would write past `length` on an existing array (or
// at any index other than 0 on a missing array). Otherwise identical
// to `setIn` — auto-creates missing object intermediates, preserves
// structural sharing, etc.
const setInSafe = (
  root: unknown,
  keys: readonly string[],
  value: unknown,
  writePath: string,
  pathSoFar: readonly string[],
): Effect.Effect<unknown, OpticOutOfBoundsError> =>
  Effect.gen(function* () {
    if (keys.length === 0) return value;
    const [head, ...rest] = keys;
    const isIndex = /^-?\d+$/.test(head);

    if (isIndex) {
      const idx = Number(head);
      const nextPath = [...pathSoFar, head];

      if (Array.isArray(root)) {
        if (idx < 0 || idx > root.length) {
          return yield* new OpticOutOfBoundsError({
            path: writePath,
            index: idx,
            length: root.length,
          });
        }
        const next = root.slice();
        next[idx] = yield* setInSafe(
          root[idx],
          rest,
          value,
          writePath,
          nextPath,
        );
        return next;
      }

      if (root === null || root === undefined) {
        // Auto-creating a fresh array — only index 0 makes sense; any
        // higher index would introduce holes.
        if (idx !== 0) {
          return yield* new OpticOutOfBoundsError({
            path: writePath,
            index: idx,
            length: 0,
          });
        }
        return [yield* setInSafe(undefined, rest, value, writePath, nextPath)];
      }
      // Numeric segment on a plain object — treat as object key (rare,
      // but `Paths<T>` for `{ "0": T }`-typed objects allows it).
    }

    const parent =
      root === null || root === undefined
        ? {}
        : (root as Record<string, unknown>);
    return {
      ...parent,
      [head]: yield* setInSafe(parent[head], rest, value, writePath, [
        ...pathSoFar,
        head,
      ]),
    };
  });

/**
 * True if a write at `writePath` should notify a subscription at
 * `subPath`. Overlap is symmetric: either path is a prefix of the
 * other (or they're equal). The empty subscription path — reserved
 * for whole-tree Readables — matches every write.
 */
const overlaps = (writePath: string, subPath: string): boolean => {
  if (subPath === "" || writePath === "") return true;
  if (subPath === writePath) return true;
  return (
    subPath.startsWith(writePath + ".") || writePath.startsWith(subPath + ".")
  );
};

// =============================================================================
// Reads
// =============================================================================

// `get` and `getUnsafe` differ only in how they project the root; the
// subscription entry is shared so both flavors on the same path attach
// to one `Set`.
const makePathReadable = <T, A>(
  optic: Optic<T>,
  path: string,
  project: (root: unknown) => A,
): Readable.Readable<A> =>
  Readable.make(
    Effect.map(SubscriptionRef.get(optic._ref), project as (root: T) => A),
    () =>
      Stream.async<A>((emit) => {
        const listener = (root: unknown) => emit.single(project(root));
        let set = optic._subs.get(path);
        if (!set) {
          set = new Set();
          optic._subs.set(path, set);
        }
        set.add(listener);
        return Effect.sync(() => {
          const s = optic._subs.get(path);
          if (!s) return;
          s.delete(listener);
          if (s.size === 0) optic._subs.delete(path);
        });
      }),
  );

/**
 * A `Readable<Option<ValueAtPath<T, P>>>` for the value at `path`.
 * `Some` when every path segment resolves to something (even an
 * intentionally-stored `undefined`); `None` when a segment along the
 * way is missing — a missing object key, an out-of-bounds array index,
 * or a primitive parent that can't be traversed further.
 *
 * For array-index paths especially — where `Paths<T>` can't know the
 * runtime length — `None` is what surfaces the "index doesn't exist
 * (yet)" case without laundering it as an unexpected `undefined`.
 *
 * `.changes` emits whenever a write overlaps this path; sibling paths
 * are ignored and equal-value writes short-circuit at the write site.
 * Use `getUnsafe` if you know the path always resolves and don't want
 * the Option wrapper.
 */
export const get: {
  <T, P extends Paths<T>>(
    optic: Optic<T>,
    path: P,
  ): Effect.Effect<Readable.Readable<Option.Option<ValueAtPath<T, P>>>>;
  <T, P extends Paths<T>>(
    path: P,
  ): (
    optic: Optic<T>,
  ) => Effect.Effect<Readable.Readable<Option.Option<ValueAtPath<T, P>>>>;
} = Fn.dual(
  2,
  <T, P extends Paths<T>>(
    optic: Optic<T>,
    path: P,
  ): Effect.Effect<Readable.Readable<Option.Option<ValueAtPath<T, P>>>> =>
    Effect.sync(() => {
      const keys = parsePath(path);
      const project = (root: unknown) =>
        getInOption(root, keys) as Option.Option<ValueAtPath<T, P>>;
      return makePathReadable(optic, path, project);
    }),
);

/**
 * A `Readable<ValueAtPath<T, P>>` for the value at `path` — the raw
 * projection, without `Option` wrapping. Asserts the path always
 * resolves; if it doesn't (e.g. an out-of-bounds array index) the
 * emitted value will be `undefined` at runtime even though the type
 * says otherwise. Prefer `get` for anything user-driven; reach for
 * `getUnsafe` when a static path guarantees resolvability and the
 * Option ceremony gets in the way.
 */
export const getUnsafe: {
  <T, P extends Paths<T>>(
    optic: Optic<T>,
    path: P,
  ): Effect.Effect<Readable.Readable<ValueAtPath<T, P>>>;
  <T, P extends Paths<T>>(
    path: P,
  ): (optic: Optic<T>) => Effect.Effect<Readable.Readable<ValueAtPath<T, P>>>;
} = Fn.dual(
  2,
  <T, P extends Paths<T>>(
    optic: Optic<T>,
    path: P,
  ): Effect.Effect<Readable.Readable<ValueAtPath<T, P>>> =>
    Effect.sync(() => {
      const keys = parsePath(path);
      const project = (root: unknown) => getIn(root, keys) as ValueAtPath<T, P>;
      return makePathReadable(optic, path, project);
    }),
);

// =============================================================================
// Writes
// =============================================================================

const emitOverlaps = (
  optic: Optic<unknown>,
  writePath: string,
  next: unknown,
) =>
  Effect.sync(() => {
    // Snapshot subscribers so iteration is stable if a listener
    // synchronously triggers another subscribe/unsubscribe. Each
    // listener projects `next` for its own path (via `getIn` or
    // `getInOption` depending on whether it was created by `getUnsafe`
    // or `get`); one entry serves both flavors.
    for (const [subPath, listeners] of Array.from(optic._subs.entries())) {
      if (!overlaps(writePath, subPath)) continue;
      for (const listener of Array.from(listeners)) {
        listener(next);
      }
    }
  });

/**
 * Bounds-checked write. Rebuilds the internal root via structural-
 * sharing immutable update, then fires every subscription whose path
 * overlaps `path`.
 *
 * Fails with `OpticOutOfBoundsError` if a numeric segment would write
 * past `length` on an existing array (or at any index other than 0 on
 * a missing array). Missing object intermediates are auto-created —
 * that's a deliberate feature (build up state incrementally without a
 * skeleton). Use `setUnsafe` to skip the bounds check.
 *
 * Overlap notification rule: notify iff `subPath === writePath`,
 * `subPath` is a strict dot-separated prefix of `writePath`, or
 * `writePath` is a strict prefix of `subPath`. Sibling paths (`a.b.c`
 * vs `a.b.d`) do not overlap.
 */
export const set: {
  <T, P extends Paths<T>>(
    optic: Optic<T>,
    path: P,
    value: ValueAtPath<T, P>,
  ): Effect.Effect<void, OpticOutOfBoundsError>;
  <T, P extends Paths<T>>(
    path: P,
    value: ValueAtPath<T, P>,
  ): (optic: Optic<T>) => Effect.Effect<void, OpticOutOfBoundsError>;
} = Fn.dual(
  3,
  <T, P extends Paths<T>>(
    optic: Optic<T>,
    path: P,
    value: ValueAtPath<T, P>,
  ): Effect.Effect<void, OpticOutOfBoundsError> =>
    Effect.gen(function* () {
      const keys = parsePath(path);
      const current = yield* SubscriptionRef.get(optic._ref);
      // Short-circuit no-ops via `Object.is` at the write point.
      const prevAtPath = getIn(current, keys);
      if (Object.is(prevAtPath, value)) return;
      const next = (yield* setInSafe(current, keys, value, path, [])) as T;
      yield* SubscriptionRef.set(optic._ref, next);
      yield* emitOverlaps(optic as Optic<unknown>, path, next);
    }),
);

/**
 * Unchecked write — same as `set` but skips the array-bounds check.
 * Silently creates holes filled with `undefined` if you write past
 * `length`; you own the resulting type violation. Prefer `set` unless
 * you have a specific reason.
 */
export const setUnsafe: {
  <T, P extends Paths<T>>(
    optic: Optic<T>,
    path: P,
    value: ValueAtPath<T, P>,
  ): Effect.Effect<void>;
  <T, P extends Paths<T>>(
    path: P,
    value: ValueAtPath<T, P>,
  ): (optic: Optic<T>) => Effect.Effect<void>;
} = Fn.dual(
  3,
  <T, P extends Paths<T>>(
    optic: Optic<T>,
    path: P,
    value: ValueAtPath<T, P>,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const keys = parsePath(path);
      const current = yield* SubscriptionRef.get(optic._ref);
      const prevAtPath = getIn(current, keys);
      if (Object.is(prevAtPath, value)) return;
      const next = setIn(current, keys, value) as T;
      yield* SubscriptionRef.set(optic._ref, next);
      yield* emitOverlaps(optic as Optic<unknown>, path, next);
    }),
);

/**
 * Bounds-checked update — apply a reducer to the current value at
 * `path`. Fails with `OpticOutOfBoundsError` under the same conditions
 * as `set`. Use `updateUnsafe` to skip the check.
 */
export const update: {
  <T, P extends Paths<T>>(
    optic: Optic<T>,
    path: P,
    fn: (value: ValueAtPath<T, P>) => ValueAtPath<T, P>,
  ): Effect.Effect<void, OpticOutOfBoundsError>;
  <T, P extends Paths<T>>(
    path: P,
    fn: (value: ValueAtPath<T, P>) => ValueAtPath<T, P>,
  ): (optic: Optic<T>) => Effect.Effect<void, OpticOutOfBoundsError>;
} = Fn.dual(
  3,
  <T, P extends Paths<T>>(
    optic: Optic<T>,
    path: P,
    fn: (value: ValueAtPath<T, P>) => ValueAtPath<T, P>,
  ): Effect.Effect<void, OpticOutOfBoundsError> =>
    Effect.gen(function* () {
      const keys = parsePath(path);
      const current = yield* SubscriptionRef.get(optic._ref);
      const currentAtPath = getIn(current, keys) as ValueAtPath<T, P>;
      const nextAtPath = fn(currentAtPath);
      if (Object.is(currentAtPath, nextAtPath)) return;
      const next = (yield* setInSafe(current, keys, nextAtPath, path, [])) as T;
      yield* SubscriptionRef.set(optic._ref, next);
      yield* emitOverlaps(optic as Optic<unknown>, path, next);
    }),
);

/**
 * Unchecked update — same as `update` but skips the array-bounds
 * check. Same caveat as `setUnsafe`.
 */
export const updateUnsafe: {
  <T, P extends Paths<T>>(
    optic: Optic<T>,
    path: P,
    fn: (value: ValueAtPath<T, P>) => ValueAtPath<T, P>,
  ): Effect.Effect<void>;
  <T, P extends Paths<T>>(
    path: P,
    fn: (value: ValueAtPath<T, P>) => ValueAtPath<T, P>,
  ): (optic: Optic<T>) => Effect.Effect<void>;
} = Fn.dual(
  3,
  <T, P extends Paths<T>>(
    optic: Optic<T>,
    path: P,
    fn: (value: ValueAtPath<T, P>) => ValueAtPath<T, P>,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const keys = parsePath(path);
      const current = yield* SubscriptionRef.get(optic._ref);
      const currentAtPath = getIn(current, keys) as ValueAtPath<T, P>;
      const nextAtPath = fn(currentAtPath);
      if (Object.is(currentAtPath, nextAtPath)) return;
      const next = setIn(current, keys, nextAtPath) as T;
      yield* SubscriptionRef.set(optic._ref, next);
      yield* emitOverlaps(optic as Optic<unknown>, path, next);
    }),
);

// =============================================================================
// Namespace
// =============================================================================

export const Optic = {
  OpticTypeId,
  OpticOutOfBoundsError,
  isOptic,
  make,
  get,
  getUnsafe,
  set,
  setUnsafe,
  update,
  updateUnsafe,
};

---
"@stax-ui/core": minor
---

feat(core): `Signal.Optic` — one root, lens-projected fine-grained readables (prototype)

Fills a gap `Signal.Struct` doesn't: deeply nested state with lazy,
fine-grained subscriptions at arbitrary paths — without hand-building
nested structs, and without giving up "only components who read this
field re-render" by mapping the whole tree.

```ts
const state = yield* Signal.Optic.make({ a: { b: { c: 0 }, d: 1 }, e: 2 });

const c = yield* Signal.Optic.get(state, "a.b.c"); // Readable<Option<number>>
const b = yield* Signal.Optic.get(state, "a.b");   // Readable<Option<{ c: number }>>

yield* Signal.Optic.set(state, "a.b.c", 3);
yield* c.get; // Option.some(3)
yield* b.get; // Option.some({ c: 3 })

yield* Signal.Optic.set(state, "a.b", { c: 5 });
yield* b.get; // Option.some({ c: 5 })
yield* c.get; // Option.some(5) — ancestor write propagates down
```

- Root handle is a `Readable<T>` of the whole tree — `.get`,
  `.changes`, `.values` all work. **No `.set` on the root** — writes
  flow only through `Signal.Optic.set` / `.setUnsafe` / `.update` /
  `.updateUnsafe`, so every mutation carries a path.
- Type-safe paths via a template-literal `Paths<T>` / `ValueAtPath<T, P>`
  pair; depth-limited (5) to keep the TS server responsive on realistic
  trees. `NonNullable` in the recursion lets paths see through optional
  / nullable fields — `x?: { y: number }` still exposes `"x.y"`.
- **Array-index syntax.** Numeric path segments walk into arrays:
  `Signal.Optic.get(state, "items.0.name")`. Writes preserve array
  shape via structural-sharing `slice()` — a write to `items[1]` keeps
  `items[0]` and `items[2]` reference-equal, so subscribers on other
  indices don't fire.
- **Safe vs unchecked variants.**
  - `get(state, path)` returns `Readable<Option<T>>` — `None` when a
    path segment doesn't resolve (missing key, out-of-bounds array
    index). Reserved for the runtime case that types can't express —
    especially arrays, where `Paths<T>` can't know the current length.
  - `getUnsafe(state, path)` returns `Readable<T>` directly (may be
    `undefined` at runtime for missing paths). For hot paths and
    static guarantees.
  - `set(state, path, value)` returns
    `Effect<void, OpticOutOfBoundsError>` — fails when a numeric
    segment would write past `length` on an existing array (or at
    any index other than 0 on a missing array). Index `=== length`
    is allowed (append). Auto-creating missing OBJECT intermediates
    stays a feature.
  - `setUnsafe` skips the bounds check (silently creates holes on
    write-past-length; you own the resulting type violation).
  - `update` / `updateUnsafe` symmetric.
- Structural sharing on writes: unaffected branches keep reference
  equality, so subscriber-side dedup and downstream memoization work
  without any explicit config.
- Overlap notification: sibling paths (`a.b.c` vs `a.b.d`) don't fire
  each other; ancestor and descendant paths do.
- `Object.is` dedup at the write site — setting a path back to its
  current value is a no-op.

### Prototype status

The string-path API is the primary surface. A composable
`Optic.lens(…)` builder for the "pass an optic across module
boundaries" case is intentionally deferred until we know whether the
concept lands. String paths are enough to prove out the runtime,
notification semantics, and TypeScript ergonomics.

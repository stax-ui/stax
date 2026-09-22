---
"@stax-ui/core": patch
---

fix(core): `reconcile` — `each` is now O(n), not O(n²), per sync

`each`'s `getItemForKey` was a linear scan (`arr.find` re-invoking `config.key`
each step), and `reconcile` called it once per slot per sync — including for
slots that already existed. So every update paid `n(n+1)/2` invocations of the
user's `key` function. Measured: 30 rows ≈ 0.034 ms/sync; 500 rows ≈ 6.2 ms/sync,
which is ~31% of wall-clock at 50 updates/sec before any DOM work. Doubling n
roughly quadrupled time — clean quadratic. Surfaced by a streaming chat UI
(high-frequency updates over a keyed list).

The fix adds an optional `prepare?: (value) => unknown` field to
`ReconcileConfig` and threads its return through every `getItemForKey` call in
that sync. `each` uses it to build a `Map<key, item>` once per sync and looks
up in O(1) per slot. Total `config.key` calls per sync drop from
`n + n(n+1)/2` to `2n`.

`prepare` is deliberately per-sync, NOT cached across syncs: `SignalArray`
mutates its backing array in place and re-emits the same reference, so an
identity-keyed memo would go stale and mis-render on
`push` / `replaceAt` / `splice` / etc. A regression test drives `each` off a
`SignalArray` to catch future reintroduction of an identity-keyed cache.

Duplicate-key semantics preserved: the Map is built with `if (!has) set` so
first occurrence wins — matches `arr.find`. Using `new Map(arr.map(...))`
would keep the LAST and silently drift; a duplicate-keys test locks in the
current behaviour.

`when` / `match` / `matchOption` / `matchEither` don't pass `getItemForKey`
or `prepare`, so their code paths are untouched.

New API surface (optional, backward-compatible): `ReconcileConfig.prepare?:
(value: A) => unknown` and a widened `getItemForKey?: (key, value, prepared) => unknown`.
Custom reconcile-based combinators can now precompute per-sync state once
and thread it through their per-slot lookups.

Also fixed defensively: `each`'s `getItemForKey` now uses optional chaining
on the cast (`(prepared as Map<...> | undefined)?.get(key)`) so the type
matches the `prepared: unknown` signature.

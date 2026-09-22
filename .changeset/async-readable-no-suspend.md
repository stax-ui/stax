---
"@stax-ui/core": minor
---

fix(core): `AsyncReadable` no longer suspends its caller on the initial fetch

`AsyncReadable.make` used to `await` its initial `runFetch()` before returning
the handle, so `const data = yield* AsyncReadable.make(...)` inside a component
suspended construction of that component and everything below it in the tree
until the request settled. Two consequences:

- `isLoading` was unobservable on first load. By the time a consumer held the
  handle, loading was already `false`. The flag only meant anything during a
  later `refetch()`, contradicting the documented intent
  (`userData.isLoading: Readable<boolean>` was supposed to be reactive from the
  first render).
- Sibling animation gates could resolve empty. An intro `Animation.sequence`
  above the creator opened its first gate, waited a tick, saw no registrants,
  and force-resolved — all before the awaited HTTP request settled and the
  actual `animated` elements mounted. The animation "just stopped working" with
  no error surface anywhere.

The initial fetch now runs in a forked fiber, and `isLoading` is flipped to
`true` synchronously in the outer scope before the fork so consumers reading it
on the very next line (or wiring a subscribe callback right after `make()`
returns) see the loading state.

**This is a behaviour change.** Code that reads `ar.value` (or `ar.error`)
immediately after `yield* AsyncReadable.make(...)` and expects a populated
`Option` will now see `Option.none()` on the next line. Reactive uses (via
`.get` in subscribers, or by passing `ar.value` into an element's attribute
binding) require no change — they observe the value flip when the fetch
settles. Callers that want the old blocking UX should wrap the component in
`Boundary.suspense`.

Same treatment for `AsyncReadable.fromReadable`, which had the identical
suspend-on-initial pattern for its first computation. `AsyncCache`'s
non-seeded path delegates to `AsyncReadable.make`, so the fix propagates
there transparently.

Design story: `Boundary.suspense` remains the suspending primitive. With this
change, the composable split is clean — `AsyncReadable` never suspends
(TanStack `useQuery` analogue), wrap in `Boundary.suspense` when the subtree
should block (TanStack `useSuspenseQuery` analogue).

Related but out of scope: `AsyncCache` with `initialData` currently means
"never fetch"; TanStack treats `initialData` as stale and revalidates. Left
as-is pending a separate decision — the SSR-hydration use case may want
today's behaviour.

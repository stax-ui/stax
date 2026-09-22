---
"@stax-ui/dom": patch
---

fix(dom): `provide` preserves the caller's `Effect` shape instead of narrowing to `Child`

`provide` is a pure passthrough over `Effect.provideService` but its type
signature was over-specific — it took `Child<E, R>` and returned
`Child<E, Exclude<R, I>>`, so any `Element<A, E, R>` passed in got downgraded
to a plain `Child<E, R>` on the way out. Real callers hit this: passing
`ThemedButton({...})` (an `Element<HTMLButtonElement, E, R>`) came back as
`Child<E, R>`, losing the button-element type for any downstream binding.

Generalized to shape-preserving generic-over-`Effect`:

```ts
provide<A, E, R, I, S>(
  tag: Context.Tag<I, S>,
  value: S,
  children: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, I>>
```

Element in → Element out. Child in → Child out. Matches how
`Effect.provideService` itself is typed — a thin wrapper shouldn't add
narrowing the wrapped operation doesn't have.

Behaviour is unchanged (implementation is still
`children.pipe(Effect.provideService(tag, value))`).

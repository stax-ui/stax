---
"@stax-ui/dom": patch
---

Fix `container.provides` resolving to `any` in the published `.d.ts`

In 0.12.0 the public `container` was declared as a function with a
namespace merge:

```ts
declare function container<…>(impl: …): ContainerFactory<…>;
declare namespace container {
    var provides: typeof provides;
}
```

Inside `namespace container`, `typeof provides` resolved to the
namespace member (self-reference) instead of the top-level `provides`
function. Under `skipLibCheck: false` that surfaced as TS2502;
under `skipLibCheck: true` (the default in most downstream projects)
`container.provides` silently collapsed to `any`, so:

- `(props, provide) => …` had `provide: any` under `strict`.
- The factory a `.provides(Tag)` Root returned was `any`, so the Tag
  wasn't removed from children's `R` via `Exclude`. "Sub-part outside
  its Root" stopped being a type error.

Fixed by building `container` as
`Object.assign(containerImpl, { provides, generic })` with an
explicit intersection type, so the emitted `.d.ts` is
`declare const container: typeof containerImpl & { provides: typeof provides; generic: typeof genericContainer }`
and the `typeof` lookups resolve unambiguously at the top level.

Also fixed a related bundler artifact in `dist/index.d.ts` where
tsup renamed the stax `Element` namespace to `Element$1` and then
over-rewrote references to the DOM global `Element` interface in
`ref.ts`'s generic constraints. The source now uses a local
`type DOMElement = globalThis.Element` alias so the bundled output
no longer conflates the two.

A new `verify-dist-types` script type-checks a fixture against the
built `dist/` with `skipLibCheck: false` to catch future regressions
of this class. It runs in CI after the build step.

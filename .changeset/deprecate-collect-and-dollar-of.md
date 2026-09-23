---
"@stax-ui/dom": patch
---

deprecate: `collect(...)` and `$.of(...)` are now marked `@deprecated`

Both are redundant now that element factories are variadic and accept
primitives / `Readable`s directly as children.

- `$.of(x)` → pass `x` directly. `$.p($.of("Hello"))` becomes `$.p("Hello")`;
  `$.span($.of(nameReadable))` becomes `$.span(nameReadable)`. Strings,
  numbers, and `Readable<string | number>` are all valid children.
- `collect(a, b, c)` → spread into the parent factory's variadic children.
  `$.div({}, collect(a, b, c))` becomes `$.div({}, a, b, c)`. Error and
  context types propagate through the variadic just as they did through
  `collect`. Only use `collect` when you need a single `Effect<ChildNode[]>`
  for a receiver that takes exactly one child (e.g., `provide(tag, value, ...)` —
  its `children` slot is a single `Effect<A, E, R>`, not variadic).

Both remain fully functional at runtime — nothing is being removed here.
TypeScript surfaces the deprecation as an editor hint (strike-through in
VS Code, "'X' is deprecated" in the tooltip); it does not fail builds or
lint. No changes required in consumer code today.

Internal sweep in the same PR modernizes all examples (`examples/**`),
the package JSDoc `@example` blocks (`Provide`, `Animation/groups`,
`Control`), the DOM README, and test-file incidental usages. Tests that
specifically exercise the deprecated APIs' behavior are preserved as-is.

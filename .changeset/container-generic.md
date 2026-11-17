---
"@stax-ui/dom": minor
---

Add `container.generic<F>()` for Roots typed by a value parameter

`container()` fixes `Props` at factory-build time, so a generic Root
whose `onValueChange` depends on a `defaultValue: ReadonlyArray<V>`
cannot infer `V` from the call site — TypeScript only carries generics
through a higher-order function when both sides are single,
non-overloaded call signatures, and `ContainerFactory` is an
intersection of overloaded interfaces.

`container.generic<F>()` is an additive sibling that lifts `V` to each
call site, using a `TypeLambda` to stand for "the props shape, given
`V`":

```ts
import type { TypeLambda } from "effect/HKT";

interface RootProps<V> {
  readonly defaultValue: ReadonlyArray<V>;
  readonly onValueChange?: (v: ReadonlyArray<V>) => void;
}
interface RootPropsF extends TypeLambda {
  readonly type: RootProps<this["Target"]>;
}

const Root = container.generic<RootPropsF>()(
  (_props, children) => $.div(children),
);

Root({ defaultValue: ["a", "b"], onValueChange: v => … });
//                                               ^? v: readonly ("a" | "b")[]
```

`container.generic<F>().provides(Tag)(impl)` and
`container.generic<F>().provides({ label: Tag, … })(impl)` mirror
`container.provides` and carry the Tag's Identifier into the
factory's `Provides` slot so children's `R` cancels through `Exclude`
the same way.

The runtime is identical to `container()` — only the exposed type
surface differs. This is safe for impls that store and compare values
without inspecting them (`===`), which covers every generic Root in
Base UI-style component catalogues (Accordion, Tabs, Toggle Group,
and so on).

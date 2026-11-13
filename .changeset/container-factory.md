---
"@stax-ui/dom": minor
---

Add `container()` factory for components that accept children

`container(impl)` returns a factory that accepts the same
`(props, ...children)` and `(props, children[])` call shapes as the
`$.div` / `$.span` factories, and threads each child's `E` and `R`
into the output element automatically — so impl doesn't need generics
for children's error and requirement channels.

When every prop on impl is optional, three call shapes are allowed:

```ts
const Leaf = container(
  (props: { tone?: "soft" | "loud" }, children) =>
    $.span({}, children),
);

Leaf();                     // no args
Leaf("hello");              // children-only
Leaf({ tone: "loud" }, "hello");
```

With at least one required prop, the no-args / children-only
overloads disappear and TypeScript demands the props object.

`container.provides(Tag)` builds a container that **supplies** a
service to its children instead of reading one. Impl receives a
`provide(service)` closure that scopes the container's children under
the Tag; the Tag's Identifier appears in the factory's `Provides`
slot so it cancels against children's R via `Exclude`. A record form,
`container.provides({ label: Tag, ... })`, provides multiple
services in one go.

The name `container` was picked over the earlier `component` to
match what the factory actually does: it exists specifically for
components that accept children. Plain functions returning Elements
remain the right shape for components that don't.

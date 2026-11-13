---
title: "Components"
description: "Define components as plain functions, wrap children with container(), and supply context via container.provides."
order: 1
---

# Components

Stax components are just functions that return Elements. There's no component class, no hooks rules, and no lifecycle methods. For the common case — a component that takes props and returns an Element — a plain function is all you need. When a component accepts **children**, reach for the `container()` factory so you get the same `(props, ...children)` call surface as `$.div` and automatic error / requirement threading from those children.

## Simple Components

Any function that returns an Element is a valid component:

```typescript
import { $ } from "@stax-ui/dom";

const Greeting = (props: { name: string }) =>
  $.h1({}, `Hello, ${props.name}!`);
```

Call it like any other Element: `yield* Greeting({ name: "World" })`. This is the right shape for anything that doesn't take children — buttons, badges, stat tiles, form fields. The [todo app example](https://github.com/stax-ui/stax/tree/main/examples/todo-app) is built entirely out of plain functions like this.

For stateful components, wrap an `Effect.gen` inside the function:

```typescript
import { Effect } from "effect";
import { $, Signal } from "@stax-ui/dom";

const Counter = () =>
  Effect.gen(function* () {
    const count = yield* Signal.make(0);

    return yield* $.div({},
      $.button({ onClick: () => count.update((n) => n - 1) }, "-"),
      $.span({}, count),
      $.button({ onClick: () => count.update((n) => n + 1) }, "+"),
    );
  });
```

`Signal.make` is scoped to the render — each `yield* Counter()` call gets its own count. `$.span` renders the Readable directly, so updates don't rebuild the component.

### Accessing Context

A component that depends on context simply `yield*` the tag:

```typescript
const UserBadge = () =>
  Effect.gen(function* () {
    const user = yield* UserCtx;
    return yield* $.span({}, user.name);
  });
```

The requirement surfaces on the component's `R` channel — rendering `UserBadge()` without a provider above it is a type error at the call site.

## Containers: Components That Take Children

As soon as a component accepts children, the plain-function pattern gets awkward. You have to declare generics on `E` and `R` so each child's error and requirement channels flow through to the output:

```typescript
import { type Element } from "@stax-ui/dom";

const Card = <E, R>(
  props: { title: string },
  children: Element.Child<E, R>,
) =>
  $.div({ class: "card" },
    $.h2({}, props.title),
    children,
  );
```

That works, but every reusable container ends up with the same boilerplate. `container()` does it for you:

```typescript
import { $, container } from "@stax-ui/dom";

const Card = container((props: { title: string }, children) =>
  $.div({ class: "card" },
    $.h2({}, props.title),
    children,
  ),
);

// Variadic children
yield* Card({ title: "Hello" },
  $.p({}, "Body text"),
  $.p({}, "More body"),
);

// Or the forwarded-array form
yield* Card({ title: "Hello" }, [
  $.p({}, "Body text"),
  $.p({}, "More body"),
]);
```

Inside impl, `children` is opaque — you pass it through to `$.div` or hand parts of it to other primitives. The factory re-attaches each child's `E` and `R` at the call site, so if a child requires `UserCtx` or might fail with `FetchError`, that propagates into `Card(...)`'s type automatically.

### Required vs. Optional Props

When every prop is optional, the factory lets you skip the props object entirely:

```typescript
const Leaf = container((props: { tone?: "soft" | "loud" }, children) =>
  $.span({ class: `leaf leaf--${props.tone ?? "soft"}` }, children),
);

Leaf();                           // no args
Leaf("hello");                    // children-only
Leaf({ tone: "loud" }, "hello");  // props + children
```

When a prop is required, the no-args / children-only overloads disappear and TypeScript demands the props object:

```typescript
const Progress = container((props: { value: number }, children) =>
  $.div({ "data-value": String(props.value) }, children),
);

Progress({ value: 10 });            // OK
Progress({ value: 10 }, "label");   // OK
// @ts-expect-error — missing required prop
Progress();
```

### Stateful Containers

Just like plain components, containers can wrap an `Effect.gen` when they need state or context:

```typescript
const Disclosure = container(
  (props: { title: string }, children) =>
    Effect.gen(function* () {
      const open = yield* Signal.make(false);
      return yield* $.div({},
        $.button({ onClick: () => open.update((v) => !v) }, props.title),
        $.div({ hidden: Readable.map(open, (v) => !v) }, children),
      );
    }),
);
```

## Providing Context

Use `container.provides(Tag)` to build a container that **supplies** a service to its children. Impl's second parameter becomes a `provide(service)` closure that scopes the children under the Tag:

```typescript
import { Context } from "effect";
import { $, container } from "@stax-ui/dom";

class ThemeCtx extends Context.Tag("ThemeCtx")<
  ThemeCtx,
  { readonly color: string }
>() {}

const ThemeRoot = container.provides(ThemeCtx)(
  (props: { color: string }, provide) =>
    $.div({ class: "theme-root" }, provide({ color: props.color })),
);

// ThemeCtx is cancelled against children's R — UserBadge's requirement
// is satisfied by ThemeRoot above it.
yield* ThemeRoot({ color: "teal" },
  UserBadge(),
);
```

`provide(service)` closes over impl's children by default. For one-off provisions that don't warrant a reusable container, the standalone `provide(Tag, value, ...children)` function from `@stax-ui/dom` still works — reach for `container.provides` when the provider itself is something you want to call like any other element.

### Providing Multiple Services

Pass a record of label-to-Tag entries. Impl receives a matching `provide({ label: service, ... })` closure, and every Tag's `Identifier` unions into the factory's Provides slot:

```typescript
class SizeCtx extends Context.Tag("SizeCtx")<
  SizeCtx,
  { readonly scale: number }
>() {}

const AppRoot = container.provides({
  theme: ThemeCtx,
  size: SizeCtx,
})((props: { color: string; scale: number }, provide) =>
  $.div({},
    provide({
      theme: { color: props.color },
      size: { scale: props.scale },
    }),
  ),
);

yield* AppRoot({ color: "teal", scale: 2 },
  UserBadge(),  // reads ThemeCtx
  Gauge(),      // reads SizeCtx
);
```

The labels are impl-local — they shape the `services` record `provide` expects and nothing more. The factory type exposes the Tags themselves.

### Scoping a Subset of Children

Both the single-tag and record forms let you route only part of `children` through `provide`. Declare the optional third parameter and hand the chosen subset to `provide` as its second argument:

```typescript
const SplitRoot = container.provides(ThemeCtx)(
  (_props: object, provide, children = []) =>
    $.div(
      children.slice(0, 1),                           // raw
      provide({ color: "lime" }, children.slice(1)),  // scoped
    ),
);
```

Use this when a layout has a header that shouldn't see the provided service but a body that should — most providers won't need it.

## Running Your App

Use `mount` to start your application:

```typescript
import { mount } from "@stax-ui/dom";

mount(App(), document.getElementById("root")!);
```

`mount` handles scoping, the signal registry, and keeping the process alive. You can pass additional layers:

```typescript
import { mount } from "@stax-ui/dom";
import { Navigation } from "@stax-ui/router";

mount(App(), document.getElementById("root")!, {
  layers: Navigation.makeLayer(router),
});
```

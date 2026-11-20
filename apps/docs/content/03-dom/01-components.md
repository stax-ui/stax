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
  $.h1(`Hello, ${props.name}!`);
```

Call it like any other Element: `yield* Greeting({ name: "World" })`. This is the right shape for anything that doesn't take children — buttons, badges, stat tiles, form fields. The [todo app example](https://github.com/stax-ui/stax/tree/main/examples/todo-app) is built entirely out of plain functions like this.

For stateful components, wrap an `Effect.gen` inside the function:

```typescript
import { Effect } from "effect";
import { $, Signal } from "@stax-ui/dom";

const Counter = () =>
  Effect.gen(function* () {
    const count = yield* Signal.make(0);

    return yield* $.div($.button({ onClick: () => count.update((n) => n - 1) }, "-"),
      $.span(count),
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
    return yield* $.span(user.name);
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
    $.h2(props.title),
    children,
  );
```

That works, but every reusable container ends up with the same boilerplate. `container()` does it for you:

```typescript
import { $, container } from "@stax-ui/dom";

const Card = container((props: { title: string }, children) =>
  $.div({ class: "card" },
    $.h2(props.title),
    children,
  ),
);

// Variadic children
yield* Card({ title: "Hello" },
  $.p("Body text"),
  $.p("More body"),
);

// Or the forwarded-array form
yield* Card({ title: "Hello" }, [
  $.p("Body text"),
  $.p("More body"),
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
      return yield* $.div($.button({ onClick: () => open.update((v) => !v) }, props.title),
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
  $.div(provide({
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

## Injecting Props into Children

Context is the right tool when children ask for a service by name (`yield* ThemeCtx`). Sometimes you need the opposite: a component wants to **inject** props into whatever its child turns out to be — an `onSubmit` into whichever element the user placed first, an `onClick` into an unknown wrapper. `MergePropsCtx` is the extension point for that.

### Providing

`MergePropsCtx` is a `Context.Tag` whose value is a plain record of props. Provide it, and the first `$`-created element inside merges those props into its own attributes — the child's explicit props win on conflict. After the merge the Tag is cleared so further descendants don't re-inherit it.

```typescript
import { Effect } from "effect";
import { $, MergePropsCtx, container } from "@stax-ui/dom";

const WithSubmitHandler = container(
  (props: { onSubmit: (e: SubmitEvent) => void }, children) =>
    Effect.provideService(
      $.div(children),
      MergePropsCtx,
      { onSubmit: props.onSubmit },
    ),
);
```

This is how `Form.provide` injects `onSubmit` into its first child, and how an `asChild` wrapper forwards props into an unknown element.

### Reading

Reading `MergePropsCtx` from a component is **also a supported pattern** — specifically, when a component needs to interleave its own behaviour before running what a parent injected. The canonical case is a validated `Form` that must sequence validation ahead of a parent-provided `onSubmit`:

```typescript
import { Effect, Option } from "effect";
import { $, MergePropsCtx, container } from "@stax-ui/dom";

const ValidatedForm = container(
  (props: { onSubmit: (e: SubmitEvent) => void }, children) =>
    Effect.gen(function* () {
      const injected = yield* Effect.serviceOption(MergePropsCtx);
      const parentOnSubmit = Option.match(injected, {
        onNone: () => undefined,
        onSome: (m) => m["onSubmit"] as ((e: SubmitEvent) => void) | undefined,
      });

      return yield* $.form(
        {
          onSubmit: (e) => {
            e.preventDefault();
            if (!validate()) return;
            props.onSubmit(e);
            parentOnSubmit?.(e);
          },
        },
        children,
      );
    }),
);
```

The Tag's `Identifier` (`"MergePropsCtx"`) and Service shape (`Record<string, unknown>`) are part of the public API — both "provide into it" and "read from it" will continue to work the same way across minor releases.

## Generic Containers

Some containers take a value parameter that has to flow from one prop to another. The canonical case is a selection Root in the Base UI shape — the caller sets `defaultValue: ["a", "b"]`, and the `onValueChange` callback should see `readonly ("a" | "b")[]` without the caller writing a type argument at the call site.

Plain `container()` can't do this. It fixes `Props` when you *build* the factory, so by the time the caller passes `defaultValue`, there's no type parameter left to infer. `container.generic<F>()` solves it by lifting the parameter to each call site, using Effect's `TypeLambda` to stand for "the props shape, given `V`":

```typescript
import type { TypeLambda } from "effect/HKT";
import { $, container } from "@stax-ui/dom";

interface RootProps<V> {
  readonly defaultValue: ReadonlyArray<V>;
  readonly onValueChange?: (v: ReadonlyArray<V>) => void;
}
interface RootPropsF extends TypeLambda {
  readonly type: RootProps<this["Target"]>;
}

const Root = container.generic<RootPropsF>()((_props, children) =>
  $.div(children),
);

Root({ defaultValue: ["a", "b"], onValueChange: (v) => {
  //                                              ^? v: readonly ("a" | "b")[]
} });
```

The runtime is identical to `container()` — only the exposed type surface differs, so it's safe for any impl that stores or compares values without inspecting their shape.

`container.generic<F>().provides(Tag)(impl)` and the record form both exist; they mirror `container.provides` and carry the Tag's `Identifier` into the factory's `Provides` slot the same way, so children's `R` cancels through `Exclude` as usual.

### Narrowing `V` Inside the `TypeLambda`

`TypeLambda`'s `Target` slot is `unknown` — Effect's HKT system has no way to express `V extends string` on it from outside. If your Root's props need `V` to be a specific shape, apply the constraint **inside** the lambda with `Extract`:

```typescript
interface StringSelectionPropsF extends TypeLambda {
  readonly type: {
    readonly value?: Extract<this["Target"], string>;
    readonly onValueChange?: (v: Extract<this["Target"], string>) => void;
  };
}

const StringRoot = container.generic<StringSelectionPropsF>()(
  (_props, children) => $.div(children),
);

StringRoot({ value: "panel-a" });   // ok — "panel-a" is a string
// @ts-expect-error — 42 is not a string
StringRoot({ value: 42 });
```

`Extract<this["Target"], string>` keeps the inferred-`V` behaviour for valid inputs and collapses to `never` (which rejects at the call site) for the rest.

### A Note on the `TypeLambda` Boilerplate

The three lines after `RootProps<V>` are TypeScript's higher-kinded-type gap. A helper that collapsed `RootPropsF` to one line would need to accept `RootProps` as a *type constructor*, and TypeScript doesn't have that. Effect itself hand-writes a `TypeLambda` interface for every data module for the same reason.

If your component library has a consistent Root shape — say, every selection Root takes `{ value?, defaultValue?, onValueChange? }` — write the canonical lambdas once at that layer:

```typescript
import type { TypeLambda } from "effect/HKT";

export interface SelectionPropsF<Extras = {}> extends TypeLambda {
  readonly type: Extras & {
    readonly value?: this["Target"];
    readonly defaultValue?: this["Target"];
    readonly onValueChange?: (v: this["Target"]) => void;
  };
}

export interface MultiSelectionPropsF<Extras = {}> extends TypeLambda {
  readonly type: Extras & {
    readonly value?: ReadonlyArray<this["Target"]>;
    readonly defaultValue?: ReadonlyArray<this["Target"]>;
    readonly onValueChange?: (v: ReadonlyArray<this["Target"]>) => void;
  };
}
```

Then `container.generic<SelectionPropsF>()` or `container.generic<MultiSelectionPropsF<{ disabled?: boolean }>>()` skips the boilerplate entirely. These helpers don't ship from `@stax-ui/dom` — the primitive doesn't take an opinion on what a Root looks like — but they're a one-time write in whatever layer *does*.

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

---
title: "Navigation"
description: "Navigate programmatically and read route state with the Navigation service."
order: 2
---

# Navigation

The Navigation service manages browser history and exposes reactive state for the current URL. It's provided as an Effect context via `Navigation.makeLayer` and consumed in components via accessor effects or the `NavigationContext` tag.

## Setting Up

Provide the Navigation layer at your app's root:

```typescript
import { Navigation } from "@stax-ui/router";
import { mount } from "@stax-ui/dom";

mount(App(), document.getElementById("root")!, {
  layers: Navigation.makeLayer(router),
});
```

Once provided, any component in the tree can navigate or read the current route.

## Programmatic Navigation

### Type-Safe Route Navigation

Use `Navigation.pushRoute` to navigate with type-safe params:

```typescript
import { Navigation } from "@stax-ui/router";

// Params are inferred from the route definition
yield* Navigation.pushRoute(UserRoute, {
  params: { id: 123 },
});

// With search params
yield* Navigation.pushRoute(SearchRoute, {
  params: {},
  searchParams: { q: "effect", page: 2 },
});

// Replace instead of push (no new history entry)
yield* Navigation.replaceRoute(UserRoute, {
  params: { id: 456 },
});
```

The type safety comes from the Route object — if `UserRoute` has `params: Schema.Struct({ id: Schema.NumberFromString })`, TypeScript enforces that you pass `{ id: number }`.

### Path-Based Navigation

When you don't need typed params:

```typescript
yield* Navigation.pushPath("/users/123");
yield* Navigation.replacePath("/login");
```

### History

```typescript
yield* Navigation.back;
yield* Navigation.forward;
```

## Reading Route State

All route state is reactive — bind it directly to your UI.

### Current Pathname

```typescript
const path = yield* Navigation.pathname;
// "string" — one-time read

// Or access the Readable for reactive binding:
const nav = yield* NavigationContext;
nav.pathname;  // Readable<string>
```

### Search Params

```typescript
const params = yield* Navigation.searchParams;
// URLSearchParams — one-time read
```

### Current Match

```typescript
const match = yield* Navigation.currentMatch;
// { route, params } — the currently matched route and raw params
```

## Link Component

For declarative navigation in the UI, use the `Link` component:

```typescript
import { Link } from "@stax-ui/router";
import { $ } from "@stax-ui/dom";

// Path-based
Link({ href: "/users" }, "Users");

// Type-safe route-based
Link(
  { to: UserRoute, params: { id: 123 } },
  "View User",
);

// With search params
Link(
  { href: "/search", searchParams: { q: "test" } },
  "Search",
);

// Replace instead of push
Link(
  { href: "/settings", replace: true },
  "Settings",
);

// External links work normally
Link(
  { href: "https://example.com", target: "_blank" },
  "External",
);
```

### Active State

Link automatically sets data attributes based on the current pathname:

- `data-active-exact="true"` — when the href matches the current path exactly
- `data-active-prefix="true"` — when the current path starts with the href

Style active links with CSS:

```css
a[data-active-exact] {
  font-weight: bold;
}

a[data-active-prefix] {
  color: var(--primary);
}
```

### Standard Anchor Behavior

Link renders a real `<a>` element. Modified clicks (Ctrl+click, Cmd+click, middle-click) work normally — they open in a new tab. Only plain left-clicks are intercepted for SPA navigation.

## Outlet

The `Outlet` component renders the currently matched route:

```typescript
import { Outlet } from "@stax-ui/router";
import { $ } from "@stax-ui/dom";

const App = () =>
  $.div(
    { class: "app" },
    Header(),
    $.main(Outlet({ router })),
    Footer(),
  );
```

Outlet reads from `NavigationContext`, matches the current pathname against the router's routes, and renders the matched route's component. When the URL changes, the previous route is unmounted and the new one is rendered.

### With Animations

```typescript
Outlet({
  router,
  animate: {
    enterFrom: "opacity-0",
    enter: "transition-opacity duration-150",
    enterTo: "opacity-100",
    exit: "transition-opacity duration-150",
    exitTo: "opacity-0",
  },
});
```

The exiting route animates out, then the entering route animates in.

### Guards and Layouts

Outlet handles guards and layouts automatically. If a matched route has a guard that returns `false`, the guard's redirect or fallback is used. Layouts wrap the matched route inside-out, as configured on the Router.

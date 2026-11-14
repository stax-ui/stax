---
title: "Elements & Attributes"
description: "Create HTML and SVG elements, set attributes, bind reactive values, and handle events."
order: 0
---

# Elements & Attributes

The `$` namespace is your entry point for creating DOM elements. Every element factory returns an Effect that produces a real DOM node — no virtual DOM, no diffing.

## Creating Elements

```typescript
import { $ } from "@stax-ui/dom";

yield* $.div({ class: "container" },
  $.h1("Hello"),
  $.p("Welcome to Stax"),
);
```

Every HTML and SVG element has a corresponding factory on `$`: `$.div`, `$.span`, `$.button`, `$.input`, `$.svg`, `$.path`, and so on.

## Children

Pass children directly as arguments after the attributes object. Strings, numbers, Readables, and other elements all work as children:

```typescript
// Single string child
yield* $.h1("Hello World");

// Multiple children of mixed types
yield* $.div("Hello",
  $.span("World"),
);

// Empty child (renders nothing)
yield* $.div($.empty);
```

When you pass a Readable as a child, the text updates automatically when the value changes:

```typescript
const count = yield* Signal.make(0);
yield* $.span(count);  // Updates in place when count changes
```

### Template Strings

The `t` tagged template creates reactive strings from Readables:

```typescript
import { t } from "@stax-ui/dom";

const name = yield* Signal.make("World");
const count = yield* Signal.make(0);

// Creates a Readable<string> that updates automatically
yield* $.p(t`Hello, ${name}! Count: ${count}`);
```

## Attributes

Elements accept an optional attributes object as the first argument. Attributes can be static or reactive:

```typescript
$.input({
  // Standard attributes
  type: "text",
  placeholder: "Enter name",
  disabled: true,
  id: "name-input",

  // Reactive attributes — UI updates automatically
  value: name,             // Readable<string>
  class: className,        // Readable<string>
  hidden: isHidden,        // Readable<boolean>

  // Style as object or string
  style: { color: "red", fontSize: "16px" },

  // Class as string, array, or Readable
  class: ["btn", isActive.pipe(Readable.map(a => a ? "btn-active" : ""))],

  // Data and ARIA attributes
  "data-testid": "name",
  "aria-label": "Name input",
  role: "textbox",

  // Ref binding
  ref: inputRef,
});
```

When you pass a Readable as an attribute value, Stax sets up a subscription — the DOM attribute updates in place whenever the Readable emits a new value. No re-rendering, no diffing.

## Event Handlers

Event handlers are functions that optionally return an Effect:

```typescript
$.button({
  onClick: (e) => count.update((n) => n + 1),
  onKeyDown: (e) => {
    if (e.key === "Enter") return submit.run();
  },
  onSubmit: (e) => {
    e.preventDefault();
    return handleSubmit();
  },
});
```

If the handler returns an Effect, Stax runs it. If it returns `void` or `undefined`, nothing extra happens. This means simple handlers stay simple, and complex ones get the full power of Effect.

Supported events include `onClick`, `onInput`, `onChange`, `onSubmit`, `onKeyDown`, `onKeyUp`, `onFocus`, `onBlur`, `onMouseDown`, `onMouseUp`, `onMouseEnter`, `onMouseLeave`, `onPointerDown`, `onPointerUp`, `onPointerMove`, `onScroll`, `onWheel`, `onDragStart`, `onDrag`, `onDragEnd`, `onDrop`, `onDragOver`, `onTouchStart`, `onTouchMove`, `onTouchEnd`, `onAnimationEnd`, `onTransitionEnd`, and more.

## SVG Elements

SVG elements are also available on `$`:

```typescript
$.svg({ viewBox: "0 0 24 24", width: 24, height: 24 },
  $.path({ d: "M12 2L2 22h20L12 2z", fill: "currentColor" }),
);
```

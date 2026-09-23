# @stax-ui/dom

DOM rendering for Stax applications. This package provides elements, components, control flow primitives, animation, SSR/hydration, and mounting utilities.

> **Note:** This package re-exports everything from `@stax-ui/core`. You don't need to install both.

## Installation

```bash
pnpm add @stax-ui/dom effect
```

## Subpath Exports

| Import Path | Purpose |
|-------------|---------|
| `@stax-ui/dom` | Main export — elements, control flow, utilities, and all of `@stax-ui/core` |
| `@stax-ui/dom/server` | Server-side rendering (`renderToString`) |
| `@stax-ui/dom/hydrate` | Client-side hydration (`hydrate`) |

## Basic Usage

### Simple Components

Components without state or context requirements can be plain functions:

```ts
import { $ } from "@stax-ui/dom";

const Greeting = (props: { name: string }) =>
  $.div(
    { class: "greeting" },
    $.h1({}, `Hello, ${props.name}!`),
    $.p({}, "Welcome to Stax"),
  );
```

### Stateful Components

Components that need signals, context, or other Effects use `Effect.gen`:

```ts
import { Effect } from "effect";
import { $, Signal } from "@stax-ui/dom";

const Counter = () =>
  Effect.gen(function* () {
    const count = yield* Signal.make(0);

    return yield* $.div(
      {},
      $.button({ onClick: () => count.update((n) => n - 1) }, "-"),
      $.span({}, count),
      $.button({ onClick: () => count.update((n) => n + 1) }, "+"),
    );
  });
```

### Running Your App

Use `mount` to start your application:

```ts
import { mount } from "@stax-ui/dom";

mount(App(), document.getElementById("root")!);
```

`mount` handles all the boilerplate: scoping, `SignalRegistry`, the client-side rendering layers, and keeping the app alive for the lifetime of the page. Pass `options.layers` for additional services (typically a router, plus anything else the app needs):

```ts
mount(App(), document.getElementById("root")!, {
  layers: Navigation.makeLayer(router),
});
```

## Elements

The `$` namespace contains factories for all HTML and SVG elements. Elements are Effects that produce DOM nodes:

```ts
yield* $.div(
  { class: "container", style: { color: "red" } },
  $.h1({}, name),
  $.p({}, t`${count} items`),
);
```

### Children

Pass children directly after the attributes object. Strings, numbers, Readables, and Elements all work — pass them individually as variadic args:

```ts
// Single child
yield* $.h1({}, "Hello World");

// Multiple children of mixed types
yield* $.div({},
  "Hello",
  $.span({}, "World"),
);

// Conditional children — `false`, `null`, `undefined` are skipped
yield* $.div({}, cond && $.span({}, "shown"));

// Empty child (explicit no-op)
yield* $.div({}, $.empty);
```

### Attributes

Elements accept an optional attributes object as the first argument:

```ts
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

### Event Handlers

Event handlers are functions that optionally return an Effect:

```ts
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

Supported events include: `onClick`, `onInput`, `onChange`, `onSubmit`, `onKeyDown`, `onKeyUp`, `onFocus`, `onBlur`, `onMouseDown`, `onMouseUp`, `onMouseEnter`, `onMouseLeave`, `onPointerDown`, `onPointerUp`, `onPointerMove`, `onScroll`, `onWheel`, `onDragStart`, `onDrag`, `onDragEnd`, `onDrop`, `onDragOver`, `onTouchStart`, `onTouchMove`, `onTouchEnd`, `onAnimationEnd`, `onTransitionEnd`, and more.

### SVG Elements

SVG elements are also available on `$`:

```ts
$.svg({ viewBox: "0 0 24 24", width: 24, height: 24 },
  $.path({ d: "M12 2L2 22h20L12 2z", fill: "currentColor" }),
);
```

### Template Strings

The `t` tagged template creates reactive strings from Readables:

```ts
import { t } from "@stax-ui/dom";

const name = yield* Signal.make("World");
const count = yield* Signal.make(0);

// Creates a Readable<string> that updates automatically
yield* $.p({}, t`Hello, ${name}! Count: ${count}`);
```

## Defining Components

### Simple (No State/Context)

Components without state or context requirements are plain functions that return an Element:

```ts
const Greeting = (props: { name: string }) =>
  $.h1({}, `Hello, ${props.name}!`);

// With variadic children — generic over E and R to propagate types.
// Use `Children<E, R>` when the wrapper interleaves its own elements
// with forwarded children (as here — the wrapper adds its own <h2>).
const Card = <E = never, R = never>(
  props: { title: string },
  ...children: Children<E, R>
) =>
  $.div(
    { class: "card" },
    $.h2({}, props.title),
    children,
  );
```

### With State or Context

Use `Effect.gen` when you need signals, context, or other Effects:

```ts
const Counter = () =>
  Effect.gen(function* () {
    const count = yield* Signal.make(0);
    return yield* $.div(
      {},
      $.button({ onClick: () => count.update((n) => n - 1) }, "-"),
      $.span({}, count),
      $.button({ onClick: () => count.update((n) => n + 1) }, "+"),
    );
  });

const UserBadge = () =>
  Effect.gen(function* () {
    const user = yield* UserContext;  // Requires context
    return yield* $.span({}, user.name);
  });
```

### Context Providers

```ts
import { Context, Effect } from "effect";
import { $, provide } from "@stax-ui/dom";

class ThemeContext extends Context.Tag("ThemeContext")<ThemeContext, Theme>() {}

const ThemedButton = (props: { label: string }) =>
  Effect.gen(function* () {
    const theme = yield* ThemeContext;
    return yield* $.button(
      { style: { backgroundColor: theme.primary } },
      props.label,
    );
  });

// Provide context to children
$.div({}, provide(ThemeContext, theme, ThemedButton({ label: "Click" })));
```

## Control Flow

### when

Conditionally render based on a reactive boolean:

```ts
import { when } from "@stax-ui/dom";

when(isLoggedIn, {
  onTrue: () => $.div({}, "Welcome back!"),
  onFalse: () => $.div({}, "Please log in"),
});
```

### match

Pattern match on a reactive value:

```ts
import { match } from "@stax-ui/dom";

match(status, {
  cases: [
    { pattern: "loading", render: () => Spinner() },
    { pattern: "error", render: () => ErrorMessage() },
    { pattern: "success", render: () => Content() },
  ],
  fallback: () => $.div({}, "Unknown"),
});
```

### each

Render a list with automatic keying and reconciliation:

```ts
import { each } from "@stax-ui/dom";

each(todos, {
  key: (todo) => todo.id,
  render: (todo, index) => TodoItem({ todo, index }),
  container: () => $.ul({ class: "todo-list" }),
});
```

The `render` callback receives `Readable<T>` items and `Readable<number>` indices — item identity is preserved across reorders. Only the changed items are updated.

### matchOption / matchEither

Match on Option or Either values. The inner value is unwrapped as a Readable:

```ts
import { matchOption, matchEither } from "@stax-ui/dom";

// userData.value is Readable<Option<User>>
matchOption(userData.value, {
  onSome: (user) => UserCard({ user }),  // user is Readable<User>
  onNone: () => $.div({}, "No user"),
});

matchEither(result, {
  onRight: (value) => SuccessView({ value }),  // value is Readable<A>
  onLeft: (error) => ErrorView({ error }),     // error is Readable<E>
});
```

### redraw

Completely rebuild the component subtree whenever a Readable changes (use sparingly — `when`/`match`/`each` are usually better):

```ts
import { redraw } from "@stax-ui/dom";

redraw(locale, {
  render: (currentLocale) => LocalizedApp({ locale: currentLocale }),
});
```

## Async Boundaries

### Suspense

Handle async rendering with loading states:

```ts
import { Boundary } from "@stax-ui/dom";

Boundary.suspense({
  render: () =>
    Effect.gen(function* () {
      const user = yield* fetchUser(id);
      return yield* UserProfile({ user });
    }),
  fallback: () => $.div({}, "Loading..."),
  catch: (error) => $.div({}, `Error: ${error.message}`),
  delay: "200 millis", // Avoid loading flash for fast responses
});
```

### Error Boundary

```ts
Boundary.error(
  () => RiskyComponent(),
  (error) => $.div({}, `Failed: ${error.message}`),
);
```

## Server-Side Rendering

### renderToString

```ts
import { renderToString } from "@stax-ui/dom/server";

const handler = Effect.gen(function* () {
  const html = yield* renderToString(App());
  return new Response(`
    <!DOCTYPE html>
    <html>
      <body>
        <div id="root">${html}</div>
        <script src="/app.js"></script>
      </body>
    </html>
  `);
});
```

Options:
- `hydrate` (default: `true`) — include hydration markers in the output. Set to `false` for static rendering.

### Hydration

```ts
import { hydrate } from "@stax-ui/dom/hydrate";
import { App } from "./App";

hydrate(App(), document.getElementById("root")!);
```

With options:

```ts
hydrate(App(), document.getElementById("root")!, {
  onMismatch: (message, node) => console.warn("Mismatch:", message),
  layers: myAppLayer,  // Additional layers to provide during hydration
});
```

Hydration attaches to server-rendered HTML and sets up reactive bindings without re-rendering the DOM. The component tree must match what was rendered on the server.

## Element Manipulation

The `Element` namespace provides pipeable functions for imperative DOM manipulation. These are useful for refs and one-off operations:

```ts
import { Element, ref } from "@stax-ui/dom";

const buttonRef = yield* ref<HTMLButtonElement>();

// Pipe operations on the ref
yield* buttonRef.pipe(
  Element.addClass("active"),
  Element.setStyles({ color: "blue" }),
  Element.focus,
);
```

### Attribute Operations

```ts
yield* el.pipe(Element.setAttribute("aria-expanded", "true"));
yield* el.pipe(Element.removeAttribute("disabled"));
yield* el.pipe(Element.toggleAttribute("hidden"));
yield* el.pipe(Element.hasAttribute("disabled")); // Effect<boolean>

// Reactive binding — attribute updates when readable changes
yield* el.pipe(Element.bindAttribute("aria-label", labelReadable));
yield* el.pipe(Element.bindBooleanAttribute("disabled", isDisabled));
```

### Class Operations

```ts
yield* el.pipe(Element.addClass("active", "highlighted"));
yield* el.pipe(Element.removeClass("loading"));
yield* el.pipe(Element.toggleClass("expanded"));
yield* el.pipe(Element.replaceClass("old-class", "new-class"));
yield* el.pipe(Element.setClass("entirely-new-class"));

// Reactive binding
yield* el.pipe(Element.bindClass(classNameReadable));
```

### Style Operations

```ts
yield* el.pipe(Element.setStyle("backgroundColor", "red"));
yield* el.pipe(Element.setStyles({ opacity: "1", fontSize: "16px" }));
yield* el.pipe(Element.removeStyle("color"));

// Reactive binding
yield* el.pipe(Element.bindStyle("color", colorReadable));
```

### Data Attributes

```ts
yield* el.pipe(Element.setData("state", "open"));    // data-state="open"
yield* el.pipe(Element.removeData("state"));
yield* el.pipe(Element.getData("state"));             // Effect<string, DataAttributeNotFound>

// Reactive binding
yield* el.pipe(Element.bindData("state", stateReadable));
```

### Content Operations

```ts
yield* el.pipe(Element.setTextContent("Hello"));
yield* el.pipe(Element.setInnerHTML("<em>bold</em>"));
yield* el.pipe(Element.setInputValue("new value"));  // Without cursor reset

// Reactive bindings
yield* el.pipe(Element.bindTextContent(textReadable));
yield* el.pipe(Element.bindInputValue(valueReadable));
```

### Focus & Interaction

```ts
yield* el.pipe(Element.focus);
yield* el.pipe(Element.blur);
yield* el.pipe(Element.click);
yield* el.pipe(Element.focusFirst("[data-item]"));  // Focus first matching descendant
yield* el.pipe(Element.focusLast("[data-item]"));

yield* el.pipe(Element.getBoundingClientRect); // Effect<DOMRect>
yield* el.pipe(Element.getId);                 // Effect<string>
yield* el.pipe(Element.contains(childNode));   // Effect<boolean>
```

### Event Listeners

```ts
yield* el.pipe(Element.on("click", (e) => handleClick(e)));
yield* el.pipe(Element.once("transitionend", (e) => afterTransition()));
```

### Utility

```ts
yield* el.pipe(Element.tap((node) => console.log(node)));
yield* el.pipe(Element.tapEffect((node) => Effect.log("mounted")));
```

## Animation

CSS-based animations for control flow transitions:

```ts
import { when, each, stagger } from "@stax-ui/dom";

// Enter/exit animations
when(isOpen, {
  onTrue: () => Modal(),
  onFalse: () => $.span(),
  animate: {
    enterFrom: "opacity-0 scale-95",
    enterTo: "opacity-100 scale-100",
    exit: "fade-out",
  },
});

// Staggered list animations
each(items, {
  key: (item) => item.id,
  render: (item) => ListItem(item),
  animate: {
    enter: "slide-in",
    exit: "slide-out",
    stagger: stagger(50), // 50ms between items
  },
});
```

### Stagger Functions

| Function | Description |
|----------|-------------|
| `stagger(delayMs)` | Fixed delay between items |
| `staggerFromCenter(delayMs)` | Items animate outward from center |
| `staggerEased(totalDurationMs, easingFn)` | Custom easing curve |
| `delay(delayMs)` | Fixed delay for all items |
| `sequence(...delays)` | Sequential delays |
| `parallel()` | All items animate simultaneously |

## Virtual List

For large lists (1000+ items), use `virtualEach` to only render visible items:

```ts
import { virtualEach, VirtualListRef } from "@stax-ui/dom";

// Basic usage
virtualEach(items, {
  key: (item) => item.id,
  itemHeight: 48,
  height: 400,
  render: (item) => $.li({}, item.pipe(Readable.map((i) => i.text))),
});
```

With scroll control:

```ts
const listRef = yield* VirtualListRef.make();

yield* virtualEach(items, {
  key: (item) => item.id,
  itemHeight: 60,
  height: 400,
  overscan: 5,        // Render 5 extra items above/below viewport
  ref: listRef,
  render: (item, index) => ListItem({ item, index }),
});

// Scroll to item 100
yield* listRef.ready.pipe(
  Effect.flatMap((control) => control.scrollTo(100))
);

// Other controls
control.scrollToTop();
control.scrollToBottom();
control.visibleRange;   // Readable<{ start: number, end: number }>
control.totalItems;     // Readable<number>
```

## Portal

Render children into a different DOM node:

```ts
import { Portal } from "@stax-ui/dom";

// Render into document.body (default)
Portal(() => Modal({ title: "Hello" }));

// Render into specific element
Portal({ target: "#modal-root" }, () => Dropdown());
Portal({ target: existingElement }, () => Tooltip());
```

## DOM Utilities

### Ref

Create refs to DOM elements for imperative access:

```ts
import { ref } from "@stax-ui/dom";

const inputRef = yield* ref<HTMLInputElement>();

// Pass to element
yield* $.input({ ref: inputRef, type: "text" });

// Use later — waits until element is mounted
yield* inputRef.pipe(Element.focus);

// Check connection status
inputRef.isConnected;  // Readable<boolean>
```

### FocusTrap

Trap focus within a container (for modals, dialogs):

```ts
import { FocusTrap } from "@stax-ui/dom";

yield* FocusTrap.make({
  container: dialogElement,
  initialFocus: firstInput,        // Optional: focus this element first
  returnFocus: triggerElement,     // Optional: focus returns here on release
});
// Focus is trapped until scope closes
```

### Keyboard

Declarative keyboard shortcuts. Cross-platform modifier handling (`mod` → `Meta` on Mac, `Ctrl` elsewhere), automatic cleanup, and a smart default that skips `preventDefault` when the event target is an editable element (so global bindings don't block typing in inputs):

```ts
import { Effect } from "effect";
import { Keyboard } from "@stax-ui/dom";

// Global
yield* Keyboard.on("mod+k", () => Effect.sync(() => open.set(true)));

// Element-local via ElementRef — follows the mount/unmount lifecycle
yield* Keyboard.on("Escape", () => Effect.sync(() => close()), {
  target: containerRef,
});

// Multiple bindings, one handler
yield* Keyboard.on(["ArrowDown", "j"], moveDown, { target: containerRef });
```

Handler must return `Effect<void, never, never>` — plain-function handlers are refused so uncaught side-effects can't sneak in. Bindings follow the canonical `KeyboardEvent.key` values (case-insensitive); the one alias is `"Space"` for the literal space character.

### ScrollLock

Prevent body scrolling (for modals). Accounts for scrollbar width to prevent layout shift:

```ts
import { ScrollLock } from "@stax-ui/dom";

yield* ScrollLock.lock;
// Body scroll is locked until scope closes
```

### UniqueId

Generate unique IDs for ARIA relationships:

```ts
import { UniqueId } from "@stax-ui/dom";

const labelId = yield* UniqueId.make("label");
const inputId = yield* UniqueId.make("input");

yield* $.div(
  {},
  $.label({ id: labelId, htmlFor: inputId }, "Name"),
  $.input({ id: inputId, "aria-labelledby": labelId }),
);
```

## API Reference

### Elements

| Export | Description |
|--------|-------------|
| `$.<element>(attrs?, ...children)` | Create an HTML/SVG element with variadic children |
| `$.of(value)` | **Deprecated.** Pass primitives / Readables directly as children instead. |
| `$.empty` | Empty child (produces no DOM nodes) |
| `collect(...children)` | **Deprecated.** Element factories are variadic — spread children directly. |
| `t\`template\`` | Create reactive template string |
| `provide(tag, value, children)` | Provide context to children |

### Mounting

| Export | Description |
|--------|-------------|
| `mount(element, container, options?)` | Start a client-side application: mounts the element and stays alive for the lifetime of the page |
| `renderToString(element, options?)` | SSR — from `@stax-ui/dom/server` |
| `hydrate(element, container, options?)` | Hydration — from `@stax-ui/dom/hydrate` |

### Control Flow

| Export | Description |
|--------|-------------|
| `when(condition, config)` | Conditional rendering |
| `match(value, config)` | Pattern matching |
| `each(items, config)` | Keyed list rendering |
| `matchOption(option, config)` | Match on Option |
| `matchEither(either, config)` | Match on Either |
| `redraw(readable, config)` | Full redraw on change |

### Boundaries

| Export | Description |
|--------|-------------|
| `Boundary.suspense(options)` | Async loading boundary with fallback |
| `Boundary.error(render, catch)` | Error boundary |

### Animation

| Export | Description |
|--------|-------------|
| `stagger(delayMs)` | Linear stagger between items |
| `staggerFromCenter(delayMs)` | Center-out stagger |
| `staggerEased(totalMs, easingFn)` | Easing-based stagger |
| `delay(delayMs)` | Fixed delay |
| `sequence(...delays)` | Sequential delays |
| `parallel()` | Simultaneous animation |

### Virtual List

| Export | Description |
|--------|-------------|
| `virtualEach(items, config)` | Virtualized list rendering |
| `VirtualListRef.make()` | Create scroll control ref |

### DOM Utilities

| Export | Description |
|--------|-------------|
| `ref<T>()` | Create element ref |
| `FocusTrap.make(options)` | Trap focus in container |
| `Keyboard.on(binding, handler, options?)` | Bind a keyboard shortcut |
| `ScrollLock.lock` | Lock body scroll |
| `UniqueId.make(prefix?)` | Generate unique ID |
| `Portal(options?, children)` | Render to different DOM node |

### Element Namespace

The `Element` namespace contains all pipeable manipulation functions. Key categories:

| Category | Functions |
|----------|-----------|
| Attributes | `setAttribute`, `removeAttribute`, `toggleAttribute`, `bindAttribute`, `bindBooleanAttribute` |
| Classes | `setClass`, `addClass`, `removeClass`, `toggleClass`, `replaceClass`, `bindClass` |
| Styles | `setStyle`, `setStyles`, `removeStyle`, `bindStyle` |
| Data | `setData`, `removeData`, `getData`, `bindData` |
| Content | `setTextContent`, `setInnerHTML`, `setInputValue`, `bindTextContent`, `bindInnerHTML`, `bindInputValue` |
| Focus | `focus`, `blur`, `click`, `focusFirst`, `focusLast` |
| Events | `on`, `once`, `addEventListener`, `removeEventListener` |
| Query | `getBoundingClientRect`, `getId`, `hasAttribute`, `contains` |
| Children | `appendChild`, `clearChildren` |
| Misc | `setRef`, `tap`, `tapEffect` |

### Renderer

| Export | Description |
|--------|-------------|
| `DOMRenderer` | DOM implementation of the Renderer interface |
| `DOMRendererLive` | Layer providing DOMRenderer |

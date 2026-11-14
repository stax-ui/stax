---
title: "Utilities"
description: "Portal, FocusTrap, ScrollLock, UniqueId, and other DOM utilities."
order: 6
---

# Utilities

Stax includes several DOM utilities for common UI patterns: rendering into portals, trapping focus in modals, locking scroll, and generating unique IDs.

## Portal

Render children into a different DOM node, outside the current component tree. Useful for modals, tooltips, and dropdowns that need to escape `overflow: hidden` or `z-index` stacking contexts:

```typescript
import { Portal } from "@stax-ui/dom";

// Render into document.body (default)
Portal(() => Modal({ title: "Hello" }));

// Render into a specific element by selector
Portal({ target: "#modal-root" }, () => Dropdown());

// Render into a specific element by reference
Portal({ target: existingElement }, () => Tooltip());
```

The portaled content participates in the same Effect scope as the parent — context, signals, and cleanup all work as expected.

## FocusTrap

Trap keyboard focus within a container. When the user presses Tab at the last focusable element, focus wraps to the first one. Essential for accessible modals and dialogs:

```typescript
import { FocusTrap } from "@stax-ui/dom";

yield* FocusTrap.make({
  container: dialogElement,
  initialFocus: firstInput,      // Optional: focus this element on activation
  returnFocus: triggerElement,   // Optional: return focus here when released
});
// Focus is trapped until the scope closes
```

When the scope finalizes (e.g., the modal unmounts), the focus trap is released and focus returns to `returnFocus` if specified.

## Keyboard

Declarative keyboard shortcuts with automatic cleanup, cross-platform modifier handling, and a smart default that avoids blocking text inputs. The primitive that most keyboard-driven UI patterns (menus, dialogs, command palettes, feed navigation) compose on top of:

```typescript
import { Effect } from "effect";
import { Keyboard } from "@stax-ui/dom";

// Global shortcut — bound to `document`
yield* Keyboard.on("mod+k", () =>
  Effect.sync(() => paletteOpen.set(true)),
);

// Element-local via ElementRef — the listener follows the element's
// mount/unmount lifecycle automatically
yield* Keyboard.on("Escape", () => Effect.sync(() => close()), {
  target: containerRef,
});

// Multiple bindings for one handler
yield* Keyboard.on(["ArrowDown", "j"], moveDown, {
  target: containerRef,
});
```

### Binding syntax

Bindings are `[modifier+]*key` strings.

| Modifier | Meaning |
|---|---|
| `mod` | Platform-normalized: `Meta` on macOS, `Ctrl` on Windows / Linux. **Preferred for cross-platform shortcuts.** |
| `meta` | Literal Meta (Cmd on Mac, Windows key elsewhere) |
| `ctrl` | Literal Ctrl |
| `alt` | Literal Alt / Option |
| `shift` | Literal Shift |

Keys follow the canonical [`KeyboardEvent.key`](https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values) values: `"Escape"`, `"Enter"`, `"Tab"`, `"ArrowUp"`, `"ArrowDown"`, `"Home"`, `"End"`, `"F1"`, letters, digits, punctuation, etc. Case-insensitive.

For space, both `" "` (the canonical `KeyboardEvent.key` value) and `"Space"` work. `"Space"` is the only alias — it exists because a bare space is invisible in source code and code-review-hostile.

### Handler signature

Handlers must return `Effect<void, never, never>`. Plain functions aren't accepted — Stax pushes error-typed effect chains, and event handlers are exactly where uncaught exceptions like to hide. Wrap simple DOM writes in `Effect.sync`:

```typescript
yield* Keyboard.on("Escape", () => Effect.sync(() => close()));
```

### Targets

| Target | Behavior |
|---|---|
| `"document"` (default) | Global listener on `document` |
| `HTMLElement` | Bound to the specific element |
| `ElementRef` | Reactive; auto-attaches on mount, detaches on unmount |

### `preventDefault`

Choose per-binding whether the browser's default handling fires:

```typescript
// Explicit
{ preventDefault: true }
{ preventDefault: false }

// Predicate — evaluated per event
{ preventDefault: (event) => paletteOpen.value === false }

// Named predicates
{ preventDefault: Keyboard.withModifier }  // only when Ctrl/Meta/Alt is pressed
```

Omit `preventDefault` for the smart default: preventDefault fires **unless** the event target is an editable element (text `<input>`, `<textarea>`, `contenteditable`). This is what you want for global bindings like `"j"` for feed navigation — it doesn't block typing `"j"` in a search box.

### `stopPropagation`

Defaults to `false` so a parent binding for the same key still fires. Opt in when a child scope should consume the event — e.g. a nested modal's `Escape` closing only itself, not also the parent modal.

```typescript
yield* Keyboard.on("Escape", () => Effect.sync(() => closeInner()), {
  target: innerModalRef,
  stopPropagation: true,
});
```

### Dynamic bindings

`Keyboard.on` dies on malformed binding strings — a bad binding is a programmer bug. If you build bindings from user preferences or configuration and need a handleable error, call `parseBinding` yourself:

```typescript
import { parseBinding, KeyboardBindingError } from "@stax-ui/dom";

const result = yield* Effect.exit(parseBinding(userBinding));
if (Exit.isFailure(result)) {
  // Handle KeyboardBindingError — show a validation error, etc.
}
```

## ScrollLock

Prevent body scrolling while a modal or overlay is open. Handles scrollbar width compensation to prevent layout shift:

```typescript
import { ScrollLock } from "@stax-ui/dom";

yield* ScrollLock.lock;
// Body scroll is locked until the scope closes
```

When locked, the body gets `overflow: hidden` and a padding-right equal to the scrollbar width, so the page doesn't shift when the scrollbar disappears.

## UniqueId

Generate unique IDs for linking related elements — labels to inputs, ARIA attributes, etc.:

```typescript
import { UniqueId } from "@stax-ui/dom";

const labelId = yield* UniqueId.make("label");
const inputId = yield* UniqueId.make("input");

yield* $.div($.label({ id: labelId, htmlFor: inputId }, "Name"),
  $.input({ id: inputId, "aria-labelledby": labelId }),
);
```

IDs are unique within the application and include the optional prefix for readability in the DOM inspector.

## Ref

Create a reference to a DOM element for later imperative access:

```typescript
import { ref } from "@stax-ui/dom";

const inputRef = yield* ref<HTMLInputElement>();

// Pass to an element
yield* $.input({ ref: inputRef, type: "text" });

// Use later — waits until the element is mounted
yield* inputRef.pipe(Element.focus);

// Check connection status reactively
inputRef.isConnected;  // Readable<boolean>
```

`ref` is built on `Ref` from `@stax-ui/core` — it's a deferred value that resolves when the element mounts. Accessing `inputRef.pipe(...)` before the element exists will wait until it's available.

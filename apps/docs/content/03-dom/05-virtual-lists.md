---
title: "Virtual Lists"
description: "Render large lists efficiently by only mounting visible items with virtualEach."
order: 5
---

# Virtual Lists

For lists with thousands of items, rendering everything at once is too slow. `virtualEach` only renders the items currently visible in the viewport, plus a small buffer above and below.

## Basic Usage

```typescript
import { virtualEach } from "@stax-ui/dom";

virtualEach(items, {
  key: (item) => item.id,
  itemHeight: 48,
  height: 400,
  render: (item) =>
    $.li(item.pipe(Readable.map((i) => i.text))),
});
```

The `itemHeight` and `height` are in pixels. `itemHeight` is the height of each row, and `height` is the height of the scrollable container. Items outside the visible range are not mounted at all — they're created on scroll and cleaned up when they leave the viewport.

## Scroll Control

Use `VirtualListRef` to programmatically control scrolling:

```typescript
import { virtualEach, VirtualListRef } from "@stax-ui/dom";

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
  Effect.flatMap((control) => control.scrollTo(100)),
);
```

### Control API

Once the list is ready, the control object provides:

```typescript
control.scrollTo(index);       // Scroll to a specific item
control.scrollToTop();         // Scroll to the top
control.scrollToBottom();      // Scroll to the bottom
control.visibleRange;          // Readable<{ start: number, end: number }>
control.totalItems;            // Readable<number>
```

## Options

| Option | Type | Description |
|--------|------|-------------|
| `key` | `(item) => string \| number` | Unique key for each item |
| `itemHeight` | `number` | Height of each row in pixels |
| `height` | `number` | Height of the scrollable container |
| `overscan` | `number` | Extra items to render outside the viewport (default: 3) |
| `ref` | `VirtualListRef` | Ref for scroll control |
| `render` | `(item, index) => Element` | Render function for each item |

The `overscan` option controls how many extra items are rendered above and below the visible area. Higher values reduce the chance of seeing blank space during fast scrolling, at the cost of rendering more items.

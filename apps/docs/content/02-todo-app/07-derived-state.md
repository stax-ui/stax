---
title: "Derived State"
description: "Compute values from signals with Readable.map and Readable.zipWith"
order: 7
---

# Derived State

We've been using `Readable.map` to transform signal values. Now let's go deeper into derived state and add filtering to our todo app.

## Readable.map

`Readable.map` creates a derived value from a signal:

```typescript
const count = yield* Signal.make(5);

// Derived value - updates when count changes
const doubled = Readable.map(count, n => n * 2);

// Use it in the UI
$.span(doubled)  // Displays "10", updates automatically
```

The derived value:
- Updates automatically when the source changes
- Is read-only (you can't `.set()` it directly)
- Is lazy - only computes when actually used

## Adding a Filter

Let's add filter buttons: All, Active, Completed. First, add a filter Signal:

```typescript
type Filter = "all" | "active" | "completed";

const App = () =>
  Effect.gen(function* () {
    const todos = yield* Signal.make<Todo[]>([...]);
    const newTodoText = yield* Signal.make("");
    const filter = yield* Signal.make<Filter>("all");

    // ...
  });
```

## Computing Filtered Todos

Now we need a derived value that filters todos based on the current filter. We could use `Readable.map`, but we need data from *two* signals (`todos` and `filter`).

### Using Readable.zipWith

For combining multiple signals, use `Readable.zipWith`:

```typescript
import { $, each, Readable, Signal, when } from "@stax-ui/dom";

// Inside App component:
const filteredTodos = Readable.zipWith(todos, filter, (todoList, currentFilter) => {
  switch (currentFilter) {
    case "active":
      return todoList.filter(t => !t.completed);
    case "completed":
      return todoList.filter(t => t.completed);
    default:
      return todoList;
  }
});
```

`Readable.zipWith` takes:
1. Two source signals/readables
2. A function that receives both values and computes the result

When *either* source changes, the derived value recomputes.

## Rendering the Filtered List

Replace the `each(todos, ...)` with `each(filteredTodos, ...)`:

```typescript
each(filteredTodos, {
  container: () => $.ul({ class: "todo-list" }),
  key: (todo) => todo.id,
  render: (todo) => TodoItem({ todo, onToggle: toggleTodo }),
})
```

## Adding Filter Buttons

Add the filter buttons in the footer:

```typescript
$.footer({ class: "footer" },
  $.span(
    { class: "todo-count" },
    Readable.map(todos, t => {
      const remaining = t.filter(todo => !todo.completed).length;
      return `${remaining} item${remaining === 1 ? "" : "s"} left`;
    }),
  ),

  $.div({ class: "filters" },
    $.button(
      {
        class: Readable.map(filter, f => f === "all" ? "filter-btn selected" : "filter-btn"),
        onClick: () => filter.set("all"),
      },
      "All",
    ),
    $.button(
      {
        class: Readable.map(filter, f => f === "active" ? "filter-btn selected" : "filter-btn"),
        onClick: () => filter.set("active"),
      },
      "Active",
    ),
    $.button(
      {
        class: Readable.map(filter, f => f === "completed" ? "filter-btn selected" : "filter-btn"),
        onClick: () => filter.set("completed"),
      },
      "Completed",
    ),
  ),
),
```

Each button:
- Has a reactive class that highlights when selected
- Sets the filter on click

## Add Filter Styles

```css
.filters {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.filter-btn {
  padding: 4px 8px;
  border: 1px solid transparent;
  background: none;
  cursor: pointer;
}

.filter-btn:hover {
  border-color: #ddd;
}

.filter-btn.selected {
  border-color: #b83f45;
}
```

## The Complete Footer

Here's the full footer section:

```typescript
$.footer({ class: "footer" },
  $.span(
    { class: "todo-count" },
    Readable.map(todos, t => {
      const remaining = t.filter(todo => !todo.completed).length;
      return `${remaining} item${remaining === 1 ? "" : "s"} left`;
    }),
  ),

  $.div({ class: "filters" },
    $.button(
      {
        class: Readable.map(filter, f => f === "all" ? "filter-btn selected" : "filter-btn"),
        onClick: () => filter.set("all"),
      },
      "All",
    ),
    $.button(
      {
        class: Readable.map(filter, f => f === "active" ? "filter-btn selected" : "filter-btn"),
        onClick: () => filter.set("active"),
      },
      "Active",
    ),
    $.button(
      {
        class: Readable.map(filter, f => f === "completed" ? "filter-btn selected" : "filter-btn"),
        onClick: () => filter.set("completed"),
      },
      "Completed",
    ),
  ),
),
```

## Try It Out

1. Add some todos
2. Complete a few
3. Click the filter buttons
4. Watch the list update instantly!

## When to Use What

| Situation | Use |
|-----------|-----|
| Transform one signal | `Readable.map(signal, fn)` |
| Combine two signals | `Readable.zipWith(s1, s2, fn)` |
| Combine multiple signals | `Readable.zip(s1, s2, s3, ...)` |
| Just need the value once | `yield* signal.get` |

## Derived vs Computed in Other Frameworks

If you've used other frameworks:
- **Vue**: `Readable.zipWith` is like `computed()`
- **Solid**: It's like `createMemo()`
- **Svelte**: It's like `$:` reactive statements

The key difference: Stax derivations are explicit and type-safe. You always know what depends on what.

## Key Takeaways

1. **`Readable.map`** transforms a single signal
2. **`Readable.zipWith`** combines two signals
3. Derived values **update automatically** when sources change
4. Derived values are **read-only**
5. Use derived state for **computed/filtered views** of your data

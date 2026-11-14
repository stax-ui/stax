---
title: "Conditional Rendering"
description: "Show and hide elements with when and add a 'Clear Completed' button"
order: 8
---

# Conditional Rendering

Sometimes you need to show or hide parts of your UI based on state. Let's add a "Clear Completed" button that only appears when there are completed todos.

## The when Helper

The `when` helper conditionally renders elements:

```typescript
import { when } from "@stax-ui/dom";

when(condition, {
  onTrue: () => $.div("Shown when true"),
  onFalse: () => $.div("Shown when false"),  // optional
})
```

- **`condition`** - A `Readable<boolean>` or boolean
- **`onTrue`** - Rendered when condition is true
- **`onFalse`** - Rendered when condition is false (optional)

When the condition changes, elements are added/removed from the DOM automatically.

## Clear Completed Button

Let's add a button that:
1. Only shows when there are completed todos
2. Removes all completed todos when clicked

First, create a derived value for whether there are any completed todos:

```typescript
const hasCompletedTodos = Readable.map(todos, t => t.some(todo => todo.completed));
```

Then add the clear function:

```typescript
const clearCompleted = () =>
  todos.update(items => items.filter(t => !t.completed));
```

Now use `when` in the footer:

```typescript
import { $, each, Readable, Signal, when } from "@stax-ui/dom";

// In the footer:
$.footer({ class: "footer" },
  $.span(
    { class: "todo-count" },
    Readable.map(todos, t => {
      const remaining = t.filter(todo => !todo.completed).length;
      return `${remaining} item${remaining === 1 ? "" : "s"} left`;
    }),
  ),

  $.div({ class: "filters" },
    // ... filter buttons
  ),

  // Clear completed button - only shows when there are completed todos
  when(hasCompletedTodos, {
    onTrue: () => $.button(
      {
        class: "clear-completed",
        onClick: () => clearCompleted(),
      },
      "Clear completed",
    ),
  }),
),
```

## Add Styling

```css
.clear-completed {
  float: right;
  background: none;
  border: none;
  cursor: pointer;
  color: #777;
}

.clear-completed:hover {
  text-decoration: underline;
}
```

## Empty State

Let's also show a message when there are no todos at all:

```typescript
const hasTodos = Readable.map(todos, t => t.length > 0);

// Wrap the main section
when(hasTodos, {
  onTrue: () =>
    $.main(
      { class: "main" },
      each(filteredTodos, {
        container: () => $.ul({ class: "todo-list" }),
        key: (todo) => todo.id,
        render: (todo) => TodoItem({ todo, onToggle: toggleTodo }),
      }),
    ),
  onFalse: () => $.p({ class: "empty-state" }, "No todos yet. Add one above!"),
})
```

Add the empty state styling:

```css
.empty-state {
  text-align: center;
  color: #999;
  padding: 20px;
}
```

## Hiding the Footer When Empty

The footer should probably also hide when there are no todos:

```typescript
when(hasTodos, {
  onTrue: () => $.footer({ class: "footer" },
    // ... footer content
  ),
}),
```

## The Complete App Structure

Here's how the main structure looks now:

```typescript
return yield* $.div({ class: "todo-app" },
  // Header (always shown)
  $.header({ class: "header" },
    $.h1("todos"),
    $.input({
      class: "new-todo",
      placeholder: "What needs to be done?",
      autofocus: true,
      value: newTodoText,
      onInput: (e) => newTodoText.set((e.target as HTMLInputElement).value),
      onKeyDown: (e) => {
        if (e.key === "Enter") return addTodo();
        return Effect.void;
      },
    }),
  ),

  // Main section (only when todos exist)
  when(hasTodos, {
    onTrue: () => $.main({ class: "main" },
      each(filteredTodos, {
        container: () => $.ul({ class: "todo-list" }),
        key: (todo) => todo.id,
        render: (todo) => TodoItem({ todo, onToggle: toggleTodo }),
      }),
    ),
    onFalse: () => $.p({ class: "empty-state" }, "No todos yet. Add one above!"),
  }),

  // Footer (only when todos exist)
  when(hasTodos, {
    onTrue: () => $.footer({ class: "footer" },
      $.span(
        { class: "todo-count" },
        Readable.map(todos, t => {
          const remaining = t.filter(todo => !todo.completed).length;
          return `${remaining} item${remaining === 1 ? "" : "s"} left`;
        }),
      ),
      $.div({ class: "filters" },
        // Filter buttons...
      ),
      when(hasCompletedTodos, {
        onTrue: () => $.button(
          { class: "clear-completed", onClick: () => clearCompleted() },
          "Clear completed",
        ),
      }),
    ),
  }),
);
```

## when vs Conditional Classes

You might wonder when to use `when` vs just toggling CSS:

| Use `when` | Use CSS/classes |
|------------|-----------------|
| Element shouldn't exist in DOM | Element should exist but be hidden |
| Has setup/cleanup logic | Simple show/hide |
| Saves memory when hidden | Needs to preserve state |

For our "Clear Completed" button, `when` makes sense—there's no reason to have an invisible button in the DOM.

## Animations with when

You can add enter/exit animations to `when`:

```typescript
when(condition, {
  onTrue: () => $.div("Animated!"),
  animate: {
    enter: "fade-in",
    exit: "fade-out",
  },
})
```

We won't cover animations in depth here, but know that Stax supports CSS-based animations for conditional elements.

## Key Takeaways

1. **`when`** conditionally renders elements
2. Pass a **`Readable<boolean>`** as the condition
3. **`onTrue`** renders when true, **`onFalse`** when false
4. Elements are **added/removed from DOM**, not just hidden
5. Use `when` for **presence**, CSS for **visibility**

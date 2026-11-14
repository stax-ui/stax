---
title: "Toggling and Updating"
description: "Handle user interactions to toggle todo completion status"
order: 5
---

# Toggling and Updating

Our todo list displays items, but clicking the checkbox doesn't do anything. Let's make it interactive by handling the toggle action.

## The Challenge

We need to:
1. Detect when a checkbox is clicked
2. Find the corresponding todo in our array
3. Toggle its `completed` status
4. Update the UI (automatically, thanks to reactivity!)

## Passing a Toggle Handler

Since the `todos` Signal lives in `App`, we need to pass a toggle function down to `TodoItem`.

First, update the props interface and component in `src/components/TodoItem.ts`:

```typescript
import { Effect } from "effect";
import { $, Readable } from "@stax-ui/dom";

interface Todo {
  id: number;
  text: string;
  completed: boolean;
}

interface TodoItemProps {
  todo: Readable<Todo>;
  onToggle: (id: number) => Effect.Effect<void>;
}

export const TodoItem = (props: TodoItemProps) =>
  Effect.gen(function* () {
    const todoId = yield* Readable.map(props.todo, t => t.id).get;

    return yield* $.li(
      {
        class: Readable.map(props.todo, t =>
          t.completed ? "todo-item completed" : "todo-item"
        ),
      },
      $.input({
        type: "checkbox",
        class: "toggle",
        checked: Readable.map(props.todo, t => t.completed),
        onChange: () => props.onToggle(todoId),
      }),
      $.span({ class: "todo-text" }, Readable.map(props.todo, t => t.text)),
    );
  });
```

What changed:

1. **`onToggle: (id: number) => Effect.Effect<void>`** - Added to props, returns an Effect
2. **`todoId`** - We read the ID once at mount time (IDs are stable)
3. **`onChange`** - Calls `onToggle(todoId)` which returns an Effect
4. **Conditional class** - `Readable.map(props.todo, t => t.completed ? "completed" : "")` adds a class when completed

## Implementing the Toggle in App

Now update `src/main.ts` to create the toggle function and pass it down:

```typescript
import "./styles.css";
import { Effect } from "effect";
import { $, each, mount, Readable, Signal } from "@stax-ui/dom";
import { TodoItem } from "./components/TodoItem";

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");

interface Todo {
  id: number;
  text: string;
  completed: boolean;
}

const App = () =>
  Effect.gen(function* () {
    const todos = yield* Signal.Array.make<Todo>([
      { id: 1, text: "Learn Stax", completed: false },
      { id: 2, text: "Build a todo app", completed: false },
      { id: 3, text: "Ship it!", completed: false },
    ]);

    // Toggle a todo's completed status
    const toggleTodo = (id: number) =>
      todos.update(items =>
        items.map(todo =>
          todo.id === id
            ? { ...todo, completed: !todo.completed }
            : todo
        )
      );

    return yield* $.div({ class: "todo-app" },
      $.header({ class: "header" },
        $.h1("todos"),
        $.input({
          class: "new-todo",
          placeholder: "What needs to be done?",
          autofocus: true,
        }),
      ),

      $.main({ class: "main" },
        $.ul(
          { class: "todo-list" },
          each(todos, {
            key: (todo) => todo.id,
            render: (todo) => TodoItem({ todo, onToggle: toggleTodo }),
          }),
        ),
      ),

      $.footer({ class: "footer" },
        $.span(
          { class: "todo-count" },
          Readable.map(todos, t => {
            const remaining = t.filter(todo => !todo.completed).length;
            return `${remaining} item${remaining === 1 ? "" : "s"} left`;
          }),
        ),
      ),
    );
  });

mount(App(), container);
```

The key addition is `toggleTodo`:

```typescript
const toggleTodo = (id: number) =>
  todos.update(items =>
    items.map(todo =>
      todo.id === id
        ? { ...todo, completed: !todo.completed }
        : todo
    )
  );
```

This:
1. Takes a todo ID
2. Maps over all todos
3. Finds the one with matching ID and toggles its `completed` property
4. Returns an Effect that updates the Signal

## Add Completed Styling

Update your CSS to show completed todos differently:

```css
.todo-item.completed .todo-text {
  text-decoration: line-through;
  color: #aaa;
}
```

Now click a checkbox! The todo should:
- Get checked
- Show a strikethrough
- Add the "completed" class

## Understanding the Flow

Here's what happens when you click a checkbox:

1. **`onChange`** fires → calls `onToggle(todoId)`
2. **`toggleTodo`** runs → returns `todos.update(...)` Effect
3. **`todos` Signal** updates with new array
4. **`each`** detects the change
5. The specific **`TodoItem`'s `todo` Readable** updates
6. **`Readable.map()` derivations** recompute (`completed`, `class`)
7. **DOM updates** - only the checkbox and span change

No re-render of the whole list. No diffing algorithm. Just precise, surgical updates.

## Updating the Count

Our footer still shows total items. Let's fix it to show only incomplete items:

```typescript
$.span(
  { class: "todo-count" },
  Readable.map(todos, t => {
    const remaining = t.filter(todo => !todo.completed).length;
    return `${remaining} item${remaining === 1 ? "" : "s"} left`;
  }),
),
```

Now the count updates as you toggle todos!

## Key Takeaways

1. **Pass callbacks down** to child components for updates
2. **`signal.update()`** returns an Effect that modifies state immutably
3. **Conditional classes** work with `Readable.map()` returning different strings
4. **Event handlers** return Effects
5. Updates are **fine-grained**—only changed parts of the DOM update

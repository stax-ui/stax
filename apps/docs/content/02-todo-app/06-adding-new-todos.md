---
title: "Adding New Todos"
description: "Handle form input to add new todos to the list"
order: 6
---

# Adding New Todos

Time to make that input field work! We'll capture user input and add new todos to our list.

## The Plan

1. Track the input field's value in a Signal
2. Listen for Enter key press
3. Add a new todo to the list
4. Clear the input field

## Adding Input State

Update `src/main.ts` to add a Signal for the input value:

```typescript
const App = () =>
  Effect.gen(function* () {
    const todos = yield* Signal.Array.make<Todo>([
      { id: 1, text: "Learn Stax", completed: false },
      { id: 2, text: "Build a todo app", completed: false },
      { id: 3, text: "Ship it!", completed: false },
    ]);

    // Track the input field value
    const newTodoText = yield* Signal.make("");

    const toggleTodo = (id: number) =>
      todos.update(items =>
        items.map(todo =>
          todo.id === id
            ? { ...todo, completed: !todo.completed }
            : todo
        )
      );

    // Add a new todo
    const addTodo = () =>
      Effect.gen(function* () {
        const text = yield* newTodoText.get;
        if (text.trim()) {
          yield* todos.push({ id: Date.now(), text: text.trim(), completed: false });
          yield* newTodoText.set("");
        }
      });

    return yield* $.div({ class: "todo-app" },
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

      // ... rest of the app
    );
  });
```

## Breaking It Down

### Two-Way Binding

```typescript
$.input({
  value: newTodoText,
  onInput: (e) => newTodoText.set((e.target as HTMLInputElement).value),
})
```

- **`value: newTodoText`** - Binds the input's value to the Signal (display)
- **`onInput`** - Returns an Effect that updates the Signal when the user types (input)

This creates two-way binding: the Signal controls the input, and the input updates the Signal.

### Effect-Based Handlers

The `addTodo` function uses `Effect.gen` to read and write Signals:

```typescript
const addTodo = () =>
  Effect.gen(function* () {
    const text = yield* newTodoText.get;   // Read value via Effect
    if (text.trim()) {
      yield* todos.update(items => [       // Update via Effect
        ...items,
        { id: Date.now(), text: text.trim(), completed: false }
      ]);
      yield* newTodoText.set("");           // Set via Effect
    }
  });
```

Signal operations like `.get`, `.set()`, and `.update()` all return Effects. Use `yield*` inside `Effect.gen` to execute them.

### Handling Enter Key

```typescript
onKeyDown: (e) => {
  if (e.key === "Enter") return addTodo();
  return Effect.void;
}
```

We check for the Enter key and return the `addTodo()` Effect. For other keys, we return `Effect.void` (a no-op Effect).

## The Complete App So Far

Here's the full `src/main.ts`:

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

    const newTodoText = yield* Signal.make("");

    const toggleTodo = (id: number) =>
      todos.update(items =>
        items.map(todo =>
          todo.id === id
            ? { ...todo, completed: !todo.completed }
            : todo
        )
      );

    const addTodo = () =>
      Effect.gen(function* () {
        const text = yield* newTodoText.get;
        if (text.trim()) {
          yield* todos.push({ id: Date.now(), text: text.trim(), completed: false });
          yield* newTodoText.set("");
        }
      });

    return yield* $.div({ class: "todo-app" },
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

## Try It Out

1. Type in the input field
2. Press Enter
3. Watch the new todo appear!
4. The input clears automatically
5. The count updates

## Key Takeaways

1. **Two-way binding** with `value` + `onInput` returning an Effect
2. **Signal operations** (`.get`, `.set()`, `.update()`) return Effects — use `yield*` in `Effect.gen`
3. **Event handlers** return Effects (use `Effect.void` for no-ops)
4. New items appear **automatically** thanks to `each` and reactivity

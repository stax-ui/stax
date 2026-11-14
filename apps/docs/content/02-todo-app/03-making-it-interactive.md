---
title: "Making It Interactive"
description: "Add reactivity to your app with Signals"
order: 3
---

# Making It Interactive

Static HTML is nice, but we need our app to respond to user input. Enter **Signals**—Stax's reactive primitives.

## What's a Signal?

A Signal is a reactive container for a value. When the value changes, anything that depends on it automatically updates.

```typescript
import { Signal } from "@stax-ui/dom";

// Create a signal with initial value 0
const count = yield* Signal.make(0);

// Read the current value
const value = yield* count.get;  // 0

// Set a new value
yield* count.set(5);

// Update based on current value
yield* count.update(n => n + 1);  // now 6
```

Notice the `yield*` everywhere. Signals are Effects, so we need to "unwrap" them. This might feel verbose at first, but it gives us type safety and predictable behavior.

## The Problem With Our Current App

Right now, our app has hardcoded todos. We want to:
1. Store todos in a Signal
2. Have the UI automatically update when todos change

## Converting to a Component

To use Signals, we need to wrap our app in `Effect.gen`. This gives us a place to create and use reactive state.

There are currently 4 types of Signals in Stax:
- `Signal<T>`: Holds a single value of type T
- `Signal.Array<T>`: Holds an array of type T with array-specific methods
- `Signal.Set<T>`: Holds a set of type T with set-specific methods
- `Signal.Map<K, V>`: Holds a map of keys K to values  with map-specific methods

Each of them will update the UI automatically when changed. A key thing to note is that the updates are surgical. Only the parts of the DOM that depend on the changed value will update, not the whole component. `Effect.gen` runs only once at mount time.

Update `src/main.ts`:

```typescript
import "./styles.css";
import { Effect } from "effect";
import { $, mount, Readable, Signal, t } from "@stax-ui/dom";

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");

// Define our Todo type
interface Todo {
  id: number;
  text: string;
  completed: boolean;
}

// Our app as a Component
const App = () =>
  Effect.gen(function* () {
    // Create a signal to hold our todos
    const todos = yield* Signal.Array.make<Todo>([
      { id: 1, text: "Learn Stax", completed: false },
      { id: 2, text: "Build a todo app", completed: false },
    ]);

    const completedTodoCount = Readable.map(todos, t => t.filter(todo => todo.completed).length);
    const remainingTodoCount = Readable.map(todos, t => t.filter(todo => !todo.completed).length);

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
        $.ul({ class: "todo-list" },
          // Still hardcoded for now - we'll fix this next chapter
          $.li({ class: "todo-item" },
            $.input({ type: "checkbox", class: "toggle" }),
            $.span({ class: "todo-text" }, "Learn Stax"),
          ),
        ),
      ),

      $.footer({ class: "footer" },
        // Make the count reactive!
        // Note: use the `t` template literal for concatenating strings
        // with reactive values
        $.span({ class: "todo-count" }, t`${completedTodoCount} items completed`),
        $.span({ class: "todo-count" }, t`${remainingTodoCount} items left`),
      ),
    );
  });

mount(App(), container);
```

## What Changed?

1. **`Effect.gen(function* () { ... })`** - Wraps our app in a component. The `function*` makes it a generator, letting us use `yield*`.

2. **`Signal.Array.make<Todo>([...])`** - Creates a Signal holding an array of todos

3. **`Readable.map(todos, t => ...)`** - Derives a new value from the signal. When `todos` changes, this automatically updates.

## Reactive Text

Look at these lines:
```typescript
const completedTodoCount = Readable.map(todos, t => t.filter(todo => todo.completed).length);
const remainingTodoCount = Readable.map(todos, t => t.filter(todo => !todo.completed).length);
```

`Readable.map()` creates a **derived value** that updates whenever `todos` changes. The span's text content is now reactive!

## Adding Interactivity

Let's add a button to test that reactivity works. Add this after the footer:

```typescript
$.button(
  {
    class: "test-btn",
    onClick: () => todos.push({
      id: Date.now(),
      text: "New todo!",
      completed: false
    })
  },
  "Add Test Todo"
)
```

Add some CSS for the button:
```css
.test-btn {
  margin-top: 20px;
  padding: 8px 16px;
  cursor: pointer;
}
```

Now click the button! Watch the "items left" count increase automatically.

## How Event Handlers Work

Event handlers return Effects. Signal methods like `todos.push(...)` and `todos.update(...)` already return Effects, so simple handlers just work:

```typescript
onClick: () => todos.update(t => [...t, newTodo])
```

For more complex handlers, use `Effect.gen`:

```typescript
onClick: () => Effect.gen(function* () {
  console.log("Before update");
  yield* todos.update(t => [...t, newTodo]);
  console.log("After update");
})
```

When a handler has a no-op branch, return `Effect.void`.

## Understanding Reactivity

Here's what happens when you click the button:

1. `onClick` fires, calling `todos.update(...)`
2. The `todos` Signal's value changes
3. Everything derived from `todos` (like our `Readable.map()`) recomputes
4. The DOM updates automatically—only the text nodes change

This is **fine-grained reactivity**. We don't re-render the whole app. Only the specific text that depends on `todos` updates.

## Key Takeaways

1. **Signals** hold reactive values
2. Use **`Signal.make(initialValue)`** to create them
3. **`Readable.map(signal, fn)`** derives new values that update automatically
4. **Components** (`Effect.gen`) give you a place to create and manage state
5. Reactivity is **fine-grained**—only what changed updates

## Cleanup

Remove the test button before the next chapter. We'll add proper todo creation soon.

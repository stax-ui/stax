---
title: "Building the Todo List"
description: "Render lists reactively with each and create reusable components"
order: 4
---

# Building the Todo List

Our todos are stored in a Signal, but we're still rendering hardcoded items. Let's make the list dynamic using the `each` helper and create a reusable `TodoItem` component.

## The each Helper

To render a list reactively, we use `each`:

```typescript
import { each } from "@stax-ui/dom";

each(itemsSignal, {
  key: (item) => item.id,  // Unique identifier
  render: (item) => $.li(Readable.map(item, i => i.text))
})
```

The `each` helper:
- Takes a Signal containing an array
- Renders each item using the `render` function
- Uses `key` to track items (like React's `key` prop)
- Automatically adds/removes/reorders DOM elements when the array changes

## Creating a TodoItem Component

First, let's create a component for individual todo items. Create a new file `src/components/TodoItem.ts`:

```typescript
import { $, Readable } from "@stax-ui/dom";

interface Todo {
  id: number;
  text: string;
  completed: boolean;
}

interface TodoItemProps {
  todo: Readable<Todo>;
}

export const TodoItem = (props: TodoItemProps) =>
  $.li({ class: "todo-item" },
    $.input({
      type: "checkbox",
      class: "toggle",
      checked: Readable.map(props.todo, t => t.completed),
    }),
    $.span({ class: "todo-text" }, Readable.map(props.todo, t => t.text)),
  );
```

A few things to note:

1. **Plain function** - Components are just functions that return elements or `Effect.gen`
2. **`todo: Readable<Todo>`** - The todo is passed as a `Readable`, not a plain value. This lets us derive reactive values from it.
3. **`Readable.map(props.todo, t => t.text)`** - We extract the text reactively. If the todo updates, the text updates.

## Using TodoItem with each

Now update `src/main.ts`:

```typescript
import "./styles.css";
import { Effect } from "effect";
import { $, each, mount, Readable, Signal, t } from "@stax-ui/dom";
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
        each(todos, {
          key: (todo) => todo.id,
          container: () => $.ul({ class: "todo-list" }), // $.div() by default
          render: (todo) => TodoItem({ todo }),
        }),
      ),

      $.footer({ class: "footer" },
        $.span({ class: "todo-count" }, t`${completedTodoCount} items completed`),
        $.span({ class: "todo-count" }, t`${remainingTodoCount} items left`),
      ),
    );
  });

mount(App(), container);
```

The key change is:

```typescript
each(todos, {
  key: (todo) => todo.id,
  container: () => $.ul({ class: "todo-list" }),
  render: (todo) => TodoItem({ todo }),
})
```

This renders a `TodoItem` for each todo in the array. The `key` function extracts the unique ID for efficient updates.

## How each Works

When the `todos` Signal changes:

1. **Added items** - New `TodoItem` components are created and inserted
2. **Removed items** - Old `TodoItem` components are removed from the DOM
3. **Reordered items** - Elements are moved efficiently (not recreated)
4. **Updated items** - The individual `todo` Readable updates, and only affected text/attributes change

This is fine-grained: changing one todo's text doesn't recreate the entire list.

## Testing It Out

Let's add a test button again to see the list update:

```typescript
$.button(
  {
    onClick: () => todos.push({
      id: Date.now(),
      text: "New todo!",
      completed: false
    })
  },
  "Add Todo",
),
$.button(
  {
    onClick: () => todos.pop().pipe(Effect.ignore)
  },
  "Remove Last",
)
```

Click "Add Todo" and watch items appear. Click "Remove Last" and watch them disappear. The list updates smoothly!

## Component Props Pattern

Notice how we pass props to `TodoItem`:

```typescript
TodoItem({ todo })
```

And define the component as a plain function:

```typescript
const TodoItem = (props: TodoItemProps) =>
  $.li(
    // ... use props.todo
  );
```

This is a clean pattern for creating reusable components. The props object gives you type safety and clear interfaces.

## Readables in Props

The `todo` prop is a `Readable<Todo>`, not a plain `Todo`. This is important:

```typescript
// ❌ Plain value - won't update when todo changes
interface TodoItemProps {
  todo: Todo;
}

// ✅ Readable - updates automatically
interface TodoItemProps {
  todo: Readable<Todo>;
}
```

When `each` renders an item, it provides a `Readable` that tracks that specific item. When you use `Readable.map()` on it, you get a derived value that updates when the item changes.

Additionally, sometimes you may want a prop to be optionally reactive. You can define it as:

```typescript
interface MyComponentProps {
  title: Readable.Reactive<string>;
}
```

And in your component, you can normalize it to be reactive with:

```typescript
const MyComponent = (props: MyComponentProps) =>
  Effect.gen(function* () {
    const reactiveTitle = Readable.normalize(props.title);
    // Now use Readable.map(reactiveTitle, ...) as needed
  });
```

## Key Takeaways

1. **`each`** renders arrays reactively
2. Always provide a **`key`** function for efficient updates
3. The `render` function receives a **`Readable`** for each item
4. **Components** are plain functions that accept a props object
5. Use **`Readable.map()`** to derive values from Readable props

## Cleanup

Remove the test buttons before the next chapter.

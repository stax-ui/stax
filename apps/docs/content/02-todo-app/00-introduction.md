---
title: "Build a Todo App with Stax"
description: "Learn Stax fundamentals by building a complete todo application from scratch"
order: 0
---

# Build a Todo App with Stax

In this tutorial, you'll build a fully-functional todo application while learning the core concepts of Stax. By the end, you'll understand:

- How to create elements with the `$` factory
- Reactive state with Signals
- Building reusable components
- Handling user interactions
- Derived state and computed values
- Conditional rendering
- Working with lists

## What You'll Build

A todo app with the ability to:
- Add new todos
- Mark todos as complete
- Filter by status (all, active, completed)
- Clear completed todos
- Persist to localStorage

## Prerequisites

- Basic JavaScript/TypeScript knowledge
- Node.js 18+ installed
- A code editor (VS Code recommended)

## A Quick Note on Effect

Stax is built on [Effect](https://effect.website), a powerful TypeScript library for building robust applications. You don't need to understand Effect deeply to use Stax—we'll introduce concepts gradually as they become relevant.

For now, just know that when you see `yield*`, think of it like `await`:

```typescript
// async/await (familiar)
async function doSomething() {
  const result = await fetchData();
  return result;
}

// Effect.gen (same pattern)
Effect.gen(function* () {
  const result = yield* fetchData();
  return result;
});

// Effect.gen (what you'll see most in Stax)
const MyComponent = () =>
  Effect.gen(function* () {
    const count = yield* Signal.make(0);
    return yield* $.div("Hello!");
  });
```

The `yield*` is like `await`—it "unwraps" the result. The difference is that Effect tracks errors and dependencies in the type system, giving you compile-time safety that async/await can't provide.

For a deeper introduction, see **[Effect in 2 Minutes](../effect-in-2-minutes.md)**. But you don't need to read it now—we'll explain concepts as they come up. Let's start building!

## Chapters

1. [Getting Started](./01-getting-started.md) - Set up your project
2. [Your First Element](./02-your-first-element.md) - Learn the `$` factory
3. [Making It Interactive](./03-making-it-interactive.md) - Add reactive state
4. [Building the Todo List](./04-building-the-todo-list.md) - Components and lists
5. [Toggling and Updating](./05-toggling-and-updating.md) - Handle interactions
6. [Adding New Todos](./06-adding-new-todos.md) - Form handling
7. [Derived State](./07-derived-state.md) - Computed values
8. [Conditional Rendering](./08-conditional-rendering.md) - Show/hide elements
9. [Deleting Todos](./09-deleting-todos.md) - Removing items
10. [Persistence](./10-persistence.md) - Save to localStorage

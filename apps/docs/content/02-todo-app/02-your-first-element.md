---
title: "Your First Element"
description: "Learn how to create and compose elements with the $ factory"
order: 2
---

# Your First Element

The `$` factory is how you create HTML elements in Stax. Let's explore how it works and build the basic structure of our todo app.

## The $ Factory

The `$` object has a method for every HTML element:

```typescript
$.div()      // <div></div>
$.span()     // <span></span>
$.button()   // <button></button>
$.input()    // <input />
$.ul()       // <ul></ul>
$.li()       // <li></li>
// ... and so on
```

## Adding Content

Pass content as arguments:

```typescript
// Text content
$.h1("My Todo App")

// Multiple children
$.div($.h1("My Todo App"),
  $.p("A simple todo list"),
)
```

## Adding Attributes

Pass an attributes object as the first argument:

```typescript
// With attributes
$.input({ type: "text", placeholder: "What needs to be done?" })

// Attributes + content
$.button({ class: "btn-primary" }, "Add Todo")

// Attributes + children
$.div({ class: "container" },
  $.h1("My Todo App"),
  $.p("A simple todo list"),
)
```

Common attributes:
- **`class`** - CSS classes (string or array)
- **`id`** - Element ID
- **`style`** - Inline styles (object)
- **`onClick`**, **`onInput`**, etc. - Event handlers

## Building Our Todo App Structure

Let's create the basic HTML structure for our todo app. Update `src/main.ts`:

```typescript
import { $, mount } from "@stax-ui/dom";

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");

const App = () => $.div({ class: "todo-app" },
  // Header
  $.header({ class: "header" },
    $.h1("todos"),
    $.input({
      class: "new-todo",
      placeholder: "What needs to be done?",
      autofocus: true,
    }),
  ),

  // Main section (todo list)
  $.main({ class: "main" },
    $.ul({ class: "todo-list" },
      // We'll make this dynamic later
      $.li({ class: "todo-item" },
        $.input({ type: "checkbox", class: "toggle" }),
        $.span({ class: "todo-text" }, "Learn Stax"),
      ),
      $.li({ class: "todo-item" },
        $.input({ type: "checkbox", class: "toggle" }),
        $.span({ class: "todo-text" }, "Build a todo app"),
      ),
    ),
  ),

  // Footer
  $.footer({ class: "footer" },
    $.span({ class: "todo-count" }, "2 items left"),
  ),
);

mount(App(), container);
```

Save and check your browser. You should see a basic todo app structure!

## Adding Some Styles

Create a file `src/styles.css`:

```css
.todo-app {
  max-width: 500px;
  margin: 40px auto;
  font-family: system-ui, sans-serif;
}

.header h1 {
  font-size: 48px;
  color: #b83f45;
  text-align: center;
  margin-bottom: 20px;
}

.new-todo {
  width: 100%;
  padding: 16px;
  font-size: 18px;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.todo-list {
  list-style: none;
  padding: 0;
  margin: 20px 0;
}

.todo-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-bottom: 1px solid #eee;
}

.todo-text {
  flex: 1;
}

.toggle {
  width: 20px;
  height: 20px;
}

.footer {
  color: #777;
  font-size: 14px;
}
```

Import it in your `src/main.ts`:

```typescript
import "./styles.css";
// ... rest of imports
```

## Nesting and Composition

Notice how elements nest naturally:

```typescript
$.div({ class: "parent" },
  $.div({ class: "child" },
    $.span("Deeply nested content"),
  ),
)
```

This creates:
```html
<div class="parent">
  <div class="child">
    <span>Deeply nested content</span>
  </div>
</div>
```

## Class Arrays

The `class` attribute accepts arrays for cleaner conditional classes:

```typescript
// These are equivalent:
$.div({ class: "btn btn-primary btn-large" })
$.div({ class: ["btn", "btn-primary", "btn-large"] })
```

This becomes useful when classes are conditional (we'll see this later with reactivity), or when using libraries like Tailwind.

## What We've Built

We now have:
- A header with a title and input field
- A main section with a hardcoded todo list
- A footer showing the count

But it's all static! In the next chapter, we'll add reactivity with Signals to make our todos dynamic.

## Key Takeaways

1. **`$`** is a factory with methods for all HTML elements
2. Pass **attributes first**, then **content**
3. **Multiple children** can be passed as separate arguments
4. **Strings can be passed directly** as children — no wrapping needed
5. Elements **nest naturally** - just put elements inside elements

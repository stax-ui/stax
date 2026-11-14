---
title: "Getting Started"
description: "Set up a new Stax project and understand the project structure"
order: 1
---

# Getting Started

Let's create a new Stax project and get our development environment running.

## Create Your Project

Open your terminal and run:

```bash
pnpm create stax-ui@latest todo-app
```

When prompted, select:
- **Template**: SPA (Single Page Application)
- **Package manager**: pnpm (or your preference)

Once complete, navigate into the project and start the dev server:

```bash
cd todo-app
pnpm install
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser. You should see the default Stax welcome page with a counter.

## Project Structure

Your project looks like this:

```
todo-app/
├── src/
│   ├── main.ts              # Application entry point
│   └── App.ts               # Root component
├── index.html               # HTML template
├── package.json
├── tsconfig.json
└── vite.config.ts
```

The key files:

- **`src/main.ts`** - Bootstraps the app and mounts to the DOM
- **`src/App.ts`** - Your root component

## Understanding main.ts

Open `src/main.ts`. You'll see something like:

```typescript
import { $, mount } from "@stax-ui/dom";

mount(App(), container);
```

Don't worry about understanding all of this yet. The key point: `mount` starts the application and attaches it to the DOM.

## Simplify for Learning

For this tutorial, we'll start simpler. Replace the contents of `src/main.ts` with:

```typescript
import { $, mount } from "@stax-ui/dom";

// Get the root element
const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");

// Our app - just a simple div for now
const App = $.div("Hello, Stax!");

// Mount it
mount(App, container);
```

Save the file. Your browser should now show "Hello, Stax!"

## What Just Happened?

Let's break it down:

1. **`$.div("Hello, Stax!")`** - Creates a div element with text content. The `$` object has methods for every HTML element (`$.div`, `$.span`, `$.button`, etc.). Strings can be passed directly as children.

2. **`mount(App, container)`** - Takes our element, renders it, attaches it to the DOM container, and keeps the app alive for the lifetime of the page.

The `$` factory returns an Effect that, when run, creates a DOM element. Effects are lazy—they describe *what* to do, not *when* to do it. `mount` handles all the setup (rendering layers, the signal registry, keeping subscriptions alive) so your entry file stays a one-liner.

## Next Steps

You've got a working Stax app! In the next chapter, we'll explore the `$` factory in depth and build out the structure of our todo app.

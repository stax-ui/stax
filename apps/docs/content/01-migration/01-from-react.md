---
title: "Coming from React"
description: "A guide for React developers learning Stax — key differences, concept mapping, and side-by-side examples."
order: 1
---

# Coming from React

A guide for React developers learning Stax. This covers the key differences, concept mapping, and side-by-side examples to help you transition.

## Why Switch?

If you're already using [Effect](https://effect.website/) in your application, Stax lets you use the same patterns and mental model across your entire stack. No more context-switching between React's hooks model and Effect's compositional approach.

### Typed Error Handling

In React, component errors are runtime surprises. You catch them with error boundaries, but there's no compile-time visibility into what can fail.

In Stax, every element has type `Element<E, R>` where `E` is the error channel. Errors propagate through the component tree, and you **must** handle them before mounting:

```ts
// This won't compile — UserProfile might fail with ApiError
mount(UserProfile(), document.body); // Type error!

// Handle the error first
mount(
  Boundary.error(
    () => UserProfile(),
    (error) => $.div(`Failed to load: ${error.message}`),
  ),
  document.body,
); // Compiles
```

TypeScript tells you at build time which components can fail and forces you to handle it.

### Fine-Grained Reactivity (No Virtual DOM)

React re-renders entire component subtrees when state changes, then diffs a virtual DOM to find what actually changed. This works, but it's wasteful.

Stax uses signals. When a signal updates, only the DOM nodes that actually depend on that signal update. No diffing, no wasted renders:

```ts
// React: Changing count re-renders the entire component
function Counter() {
  const [count, setCount] = useState(0);
  console.log("render"); // Logs on every click
  return <div>{count}</div>;
}

// Stax: Only the text node updates
const Counter = () =>
  Effect.gen(function* () {
    const count = yield* Signal.make(0);
    console.log("render"); // Logs once, on mount
    return yield* $.div(count); // count changes update only this text
  });
```

### No Rules of Hooks

React hooks have rules you must memorize:

- Don't call hooks conditionally
- Exhaustive dependency arrays (with lint rules that don't always help)
- Stale closure bugs when you forget a dependency
- `useCallback` and `useMemo` everywhere for performance

Stax has none of this. Create signals wherever you want. Use them wherever you want. The reactivity system tracks dependencies automatically:

```ts
// React: Must memoize, manage deps, avoid stale closures
const [items, setItems] = useState([]);
const handleAdd = useCallback(() => {
  setItems((prev) => [...prev, newItem]); // Must use prev, not items!
}, []); // Stale closure if you use items directly

// Stax: Just write code
const items = yield* Signal.make([]);
const handleAdd = () => items.update((current) => [...current, newItem]); // Always fresh
```

### Automatic Resource Cleanup

React's `useEffect` cleanup is manual and easy to get wrong. Forget to clean up a subscription? Memory leak. Return a non-function? Runtime error.

Stax uses Effect's scope system. Resources are automatically cleaned up when components unmount:

```ts
// React: Manual cleanup, easy to forget
useEffect(() => {
  const subscription = eventSource.subscribe(handler);
  return () => subscription.unsubscribe(); // Don't forget!
}, []);

// Stax: Automatic cleanup via scope
yield* eventSource.pipe(
  Stream.runForEach(handler),
  Effect.forkIn(scope), // Cleaned up when scope closes
);
```

### No Re-render Cascades

In React, when a parent re-renders, all children re-render too (unless wrapped in `React.memo`). This leads to prop drilling `memo` everywhere or using context for everything.

In Stax, signal updates only notify actual subscribers. Parent "re-renders" don't exist:

```ts
// React: Parent re-render causes child re-render
function Parent() {
  const [count, setCount] = useState(0); // Child re-renders too!
  return <Child />; // Unless wrapped in memo()
}

// Stax: Parent signal doesn't affect unrelated children
const Parent = () =>
  Effect.gen(function* () {
    const count = yield* Signal.make(0); // Child doesn't care
    return yield* $.div(Child()); // Child never "re-renders"
  });
```

### Better Async

React's Suspense requires experimental features for data fetching, and error handling is separate from loading states. In Stax, it's unified:

```ts
Boundary.suspense({
  render: () =>
    Effect.gen(function* () {
      const user = yield* fetchUser(id); // Can fail!
      return yield* UserProfile({ user });
    }),
  fallback: () => $.div("Loading..."),
  catch: (error) => $.div(`Error: ${error.message}`),
  delay: "200 millis", // Avoid loading flash
});
```

## Concept Mapping

| React | Stax | Notes |
|---|---|---|
| `useState(initial)` | `Signal.make(initial)` | Must `yield*` to create |
| `useMemo(() => x, deps)` | `Readable.map(dep, (v) => x)` | Auto-tracked, no dep arrays |
| `useEffect(() => {...}, deps)` | `Readable.tap(dep, fn)` | Automatic cleanup |
| `useCallback(fn, deps)` | Just use the function | No stale closures |
| `useContext(Ctx)` | `yield* ServiceTag` | Effect services |
| `useRef(initial)` | `ref<T>()` | For DOM element refs |
| `<Component prop={x} />` | `Component({ prop: x })` | Function calls |
| `{cond && <El/>}` | `when(cond, { onTrue: () => El(), onFalse: () => $.span() })` | Object config |
| `{x != null && <El x={x}/>}` | `matchOption(optX, { onSome: (x) => El({ x }), onNone: ... })` | Unwraps Option |
| `{arr.map(x => <El key/>)}` | `each(arr, { key: x => x.id, render: x => El() })` | Key function, not prop |
| `<ErrorBoundary>` | `Boundary.error(try, catch)` | Typed errors! |
| `<Suspense>` | `Boundary.suspense({ render, fallback })` | With typed `catch` |
| Component re-render | Doesn't exist | Only signals update DOM |
| Virtual DOM diff | Doesn't exist | Direct DOM updates |
| `React.memo()` | Not needed | Fine-grained by default |

## Side-by-Side Examples

### State and Updates

```tsx
// React
function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount((c) => c + 1)}>{count}</button>;
}

// Stax
const Counter = () =>
  Effect.gen(function* () {
    const count = yield* Signal.make(0);
    return yield* $.button(
      { onClick: () => count.update((c) => c + 1) },
      count,
    );
  });
```

### Derived State

```tsx
// React
function Cart({ items }) {
  const total = useMemo(
    () => items.reduce((sum, i) => sum + i.price, 0),
    [items],
  );
  return <div>Total: ${total}</div>;
}

// Stax
const Cart = (props: { items: Readable.Readable<Item[]> }) =>
  Effect.gen(function* () {
    const total = Readable.map(props.items, (items) =>
      items.reduce((sum, i) => sum + i.price, 0),
    );
    return yield* $.div(t`Total: $${total}`);
  });
```

### Conditional Rendering

```tsx
// React
function Auth({ isLoggedIn }) {
  return isLoggedIn ? <Dashboard /> : <Login />;
}

// Stax
const Auth = (props: { isLoggedIn: Readable.Readable<boolean> }) =>
  when(props.isLoggedIn, {
    onTrue: () => Dashboard(),
    onFalse: () => Login(),
  });
```

### Lists

```tsx
// React
function TodoList({ todos }) {
  return (
    <ul>
      {todos.map((todo) => (
        <li key={todo.id}>{todo.text}</li>
      ))}
    </ul>
  );
}

// Stax
const TodoList = (props: { todos: Readable.Readable<Todo[]> }) =>
  each(props.todos, {
    container: () => $.ul(),
    key: (todo) => todo.id,
    render: (todo) =>
      $.li(Readable.map(todo, (t) => t.text)),
  });
```

### Data Fetching

```tsx
// React (with Suspense + error boundary)
function UserProfile({ id }) {
  const user = use(fetchUser(id)); // Experimental
  return <div>{user.name}</div>;
}
// Wrapped in error boundary + suspense elsewhere...

// Stax — Option 1: Boundary.suspense (one-shot)
const UserProfile = (props: { id: string }) =>
  Boundary.suspense({
    render: () =>
      Effect.gen(function* () {
        const user = yield* fetchUser(props.id);
        return yield* $.div(user.name);
      }),
    fallback: () => $.div("Loading..."),
    catch: (e) => $.div(`Error: ${e}`),
  });

// Stax — Option 2: AsyncReadable (reactive, with refetch)
const UserProfileAsync = (props: { id: string }) =>
  Effect.gen(function* () {
    const userData = yield* AsyncReadable.make(() => fetchUser(props.id));

    return yield* $.div(
      when(userData.isLoading, {
        onTrue: () => $.div("Loading..."),
        onFalse: () => $.span(),
      }),
      matchOption(userData.value, {
        onSome: (user) => $.div(Readable.map(user, (u) => u.name)),
        onNone: () => $.span(),
      }),
      matchOption(userData.error, {
        onSome: (err) => $.div({ class: "error" }, Readable.map(err, (e) => e.message)),
        onNone: () => $.span(),
      }),
    );
  });
```

### Context / Services

```tsx
// React
const ThemeContext = createContext("light");
function App() {
  return (
    <ThemeContext.Provider value="dark">
      <Page />
    </ThemeContext.Provider>
  );
}
function Page() {
  const theme = useContext(ThemeContext);
  return <div className={theme}>...</div>;
}

// Stax
class ThemeService extends Context.Tag("Theme")<ThemeService, string>() {}

const Page = () =>
  Effect.gen(function* () {
    const theme = yield* ThemeService;
    return yield* $.div({ class: theme }, "...");
  });

// Provide at mount
mount(Page().pipe(Effect.provideService(ThemeService, "dark")), root);

// Or provide inline
$.div(
  { class: "app" },
  provide(ThemeService, "dark", Page()),
);
```

### Effects / Reactions

```tsx
// React
function DocumentTitle({ title, unreadCount }) {
  useEffect(() => {
    document.title = unreadCount > 0 ? `(${unreadCount}) ${title}` : title;
  }, [title, unreadCount]);

  useEffect(() => {
    localStorage.setItem("lastTitle", title);
  }, [title]);

  return <h1>{title}</h1>;
}

// Stax
const DocumentTitle = (props: {
  title: Readable.Readable<string>;
  unreadCount: Readable.Readable<number>;
}) =>
  Effect.gen(function* () {
    // Runs whenever title or unreadCount changes
    const combined = Readable.zipWith(props.title, props.unreadCount, (title, count) =>
      count > 0 ? `(${count}) ${title}` : title,
    );
    yield* Readable.tap(combined, (t) =>
      Effect.sync(() => { document.title = t; }),
    );

    // Runs whenever title changes
    yield* Readable.tap(props.title, (title) =>
      Effect.sync(() => localStorage.setItem("lastTitle", title)),
    );

    return yield* $.h1(props.title);
  });
```

Key differences:
- **No dependency arrays to maintain** — `Readable.tap` subscribes to the readable it's given
- **No stale closure bugs** — Values are passed as parameters, not captured from scope
- **Automatic cleanup** — Subscriptions stop when the component unmounts

## Key Mindset Shifts

1. **Components don't re-render** — There's no render cycle. Signals update, and only their subscribers react.

2. **Errors are values** — Instead of try/catch around everything, errors flow through the type system. Handle them explicitly with `Boundary.error` or Effect combinators.

3. **Effects are explicit** — Side effects aren't hidden in `useEffect`. They're `Readable.tap` subscriptions or Effect values that you compose and run.

4. **Cleanup is automatic** — Effect's scope system handles resource cleanup. No more forgotten unsubscribes.

## Custom Equality

In React, `useMemo` and `useEffect` use dependency arrays with shallow comparison, and there's no built-in way to customize equality.

In Stax, equality is a first-class option on every reactive primitive:

```ts
// Only trigger updates when the user ID changes, ignoring lastSeen timestamps
const currentUser = yield* Signal.make<User>(
  { id: 1, name: "Alice", lastSeen: new Date() },
  { equals: (a, b) => a.id === b.id },
);
```

## Imperative DOM Access

In React, you use `useRef` to get DOM element references:

```tsx
// React
function FocusInput() {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFocus = () => {
    inputRef.current?.focus();
    inputRef.current?.scrollIntoView({ behavior: "smooth" });
    inputRef.current?.classList.add("focused");
  };

  return <input ref={inputRef} onClick={handleFocus} />;
}
```

In Stax, `ref()` creates a pipeable element reference:

```ts
// Stax
const FocusInput = () =>
  Effect.gen(function* () {
    const inputRef = yield* ref<HTMLInputElement>();

    const handleFocus = () =>
      inputRef.pipe(
        Element.focus,
        Element.scrollIntoView({ behavior: "smooth" }),
        Element.addClass("focused"),
      );

    return yield* $.input({ ref: inputRef, onClick: handleFocus });
  });
```

### Common React DOM Patterns

| React Pattern | Stax Equivalent |
|---|---|
| `ref.current?.focus()` | `el.pipe(Element.focus)` |
| `ref.current?.blur()` | `el.pipe(Element.blur)` |
| `ref.current?.click()` | `el.pipe(Element.click)` |
| `ref.current?.scrollIntoView()` | `el.pipe(Element.scrollIntoView())` |
| `ref.current?.classList.add("x")` | `el.pipe(Element.addClass("x"))` |
| `ref.current?.classList.remove("x")` | `el.pipe(Element.removeClass("x"))` |
| `ref.current?.classList.toggle("x")` | `el.pipe(Element.toggleClass("x"))` |
| `ref.current?.setAttribute("k", "v")` | `el.pipe(Element.setAttribute("k", "v"))` |
| `ref.current?.removeAttribute("k")` | `el.pipe(Element.removeAttribute("k"))` |
| `ref.current?.dataset.state = "x"` | `el.pipe(Element.setData("state", "x"))` |
| `ref.current?.style.color = "red"` | `el.pipe(Element.setStyle("color", "red"))` |
| `ref.current?.querySelector(".x")` | `el.pipe(Element.querySelector(".x"))` |

### Animation Hooks

Stax's animation system passes elements to lifecycle hooks, letting you use Element helpers:

```ts
when(isModalOpen, {
  onTrue: () => Modal(),
  onFalse: () => $.span(),
  animate: {
    enter: "fade-in",
    exit: "fade-out",
    onEnter: (el) => el.pipe(Element.focusFirst("[data-autofocus]")),
    onBeforeExit: (el) => el.pipe(Element.blur),
  },
});
```

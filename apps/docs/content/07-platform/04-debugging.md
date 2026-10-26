---
title: "Debugging"
description: "Strategies for debugging Stax apps, including structured framework logs and Readable debug wrappers."
order: 4
---
# Debugging

Stax emits structured debug logs at key framework boundaries — navigation, route resolution, data fetches, animation lifecycle, and reconcile handler invocations. Enable them by lowering Effect's log level to `Debug`.

## Turn on framework logs

Wherever you run your app, wrap the top-level Effect with `Logger.withMinimumLogLevel(LogLevel.Debug)`. Add a Logger layer if you want pretty output.

```typescript
import { Effect, Logger, LogLevel } from "effect";

Effect.runFork(
  program.pipe(
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.provide(Logger.pretty),
  ),
);
```

Every framework log carries a `subsystem` annotation so you can filter by area.

## Subsystems

| Annotation | What it covers |
|---|---|
| `stax.nav` | `pushPath`, `replacePath`, popstate — with `from` and `to` paths |
| `stax.outlet` | Route resolution, guard evaluations, redirects |
| `stax.route-data` | Which fetch branch was taken (provider vs SPA fallback vs static config), redirect signals from the provider |
| `stax.animation` | Enter/exit lifecycle begin/end, whether the animation was skipped, how `transitionend` resolved (`transition` / `animation` / `timeout` / `skip`) |
| `stax.reconcile` | Every reconcile sync pass with the triggering value; error-level entries for failed reconcile handlers |
| `stax.readable` | Emitted by `Readable.debug(id)` — one initial-value line plus a line per subsequent change |
| `stax.signal` | Emitted by `Signal.trace(id)` (and `Signal.Array.trace` / `Signal.Map.trace` / `Signal.Set.trace` / `Signal.Struct.trace`) — one line per `set`/`update`/mutation call, including the caller's stack |

## Filter to one subsystem

Use a custom `Logger` that only prints messages for the subsystem you're chasing:

```typescript
import { HashMap, Logger } from "effect";

const onlyNavLogger = Logger.make((opts) => {
  const subsystem = HashMap.get(opts.annotations, "subsystem");
  if (subsystem._tag !== "Some" || subsystem.value !== "stax.nav") return;
  console.log(`[${opts.logLevel.label}]`, opts.message);
});

Effect.runFork(
  program.pipe(
    Logger.withMinimumLogLevel(LogLevel.Debug),
    Effect.provide(Logger.replace(Logger.defaultLogger, onlyNavLogger)),
  ),
);
```

## Cost when disabled

Zero rendering work — messages are only built into strings by the formatter, and when the level is above `Debug`, the formatter never runs. Message arguments (the objects passed to `Effect.logDebug`) are constructed regardless — that's why the framework only logs at low-volume framework boundaries. `Signal.trace` goes a step further: it reads the current log level once at pipe time and, if Debug isn't enabled, returns the underlying Signal unwrapped, so there's no branch and no `new Error()` allocation on the hot path in production.

## Observe a specific Readable

`Readable.debug(id)` wraps any Readable-producing Effect so its initial value and every subsequent change are logged under `stax.readable`. Useful when you have a running app and just want to answer "what value does this Signal hold right now, and when does it change?"

```typescript
import { Signal, Readable } from "@stax-ui/core";

const cart = yield* Signal.make({ items: 0, total: 0 }).pipe(
  Readable.debug("cart"),
);
```

Pass-through — the returned Readable is unchanged, so debug can be added and removed without any code refactoring. The internal subscription is forked into the enclosing scope and cleaned up automatically.

## Trace writes to a Signal

`Signal.trace(id)` is the write-side counterpart. Every `set` and `update` call is logged under `stax.signal` at Debug level, with the previous value, the value being written, and the stack trace at the caller's frame — the answer to "where in the code did this update come from?"

```typescript
import { Signal } from "@stax-ui/core";

const count = yield* Signal.make(0).pipe(Signal.trace("count"));

yield* count.set(1);
// stax.signal  "write"  { id: "count", from: 0, to: 1, callSite: "Error\n    at ..." }
```

Source maps make the stack readable in browser devtools automatically; in Node, run with `--enable-source-maps`. Stack frames from `@stax-ui/core` itself are stripped so the top of the trace is your code — writes from event handlers, `Effect.sync`, and plain functions come through with their file and line intact. If your bundler downlevels generators, a write from inside `Effect.gen(function*() { … })` can occasionally collapse to `Generator.next (<anonymous>)` in the log; production browser builds with source maps almost always preserve it.

Every collection variant carries the same combinator, scoped under its namespace — `Signal.Array.trace`, `Signal.Map.trace`, `Signal.Set.trace`, `Signal.Struct.trace`. Each wraps its collection's mutation methods (`push`/`pop`/`splice`/... for arrays, `set`/`delete`/`clear`/... for maps, and so on) and emits one line per call, tagged with the method name plus the arguments it was called with.

```typescript
const todos = yield* Signal.Array.make<Todo>().pipe(
  Signal.Array.trace("todos"),
);

yield* todos.push({ id: 1, text: "buy milk" });
// stax.signal  "push"  { id: "todos", args: [{...}], callSite: "..." }
```

Collection tracing logs the method name and its arguments rather than snapshotting the collection on every write — a full copy of a large map or array would be expensive and rarely what you want. Pair with `Readable.debug` on the same signal if you also want a "value changed" line alongside each mutation.

Combinable with `Readable.debug` — the two live at different layers of the pipeline:

```typescript
const count = yield* Signal.make(0).pipe(
  Readable.debug("count"),   // reads
  Signal.trace("count"),     // writes
);
```

`update`'s reducer runs once (so non-pure updates don't double-fire); the result is applied via the underlying `set`. If you need the atomic read-modify-write semantics of `signal.update`, don't pipe `trace` on that signal.

## Adding your own debug logs

`logDebug` and `logError` are exported from `@stax-ui/core` for your own instrumentation. The `subsystem` argument is typed as `` `stax.${string}` `` so custom framework extensions can slot into the same filter mechanism.

```typescript
import { logDebug, logError } from "@stax-ui/core";

yield* logDebug("cache miss", "stax.my-extension", { key });
yield* logError("cache failure", "stax.my-extension", { cause });
```

`logDebug` is filtered by the runtime log level (opt-in visibility). `logError` always emits so users see failures without needing to configure anything.

App-level logs don't need the `stax.` prefix — use `Effect.logDebug` / `Effect.logError` and `Effect.annotateLogs` directly with whatever subsystem convention you like.

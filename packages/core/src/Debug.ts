import { Effect } from "effect";

/**
 * Subsystem tag for a framework debug log. The `stax.` prefix is enforced
 * at the type level so consumers filtering by annotation can rely on the
 * naming convention.
 */
export type Subsystem = `stax.${string}`;

/**
 * Emit a debug log annotated with an Stax subsystem tag.
 *
 * Zero cost when the runtime log level is above Debug (the default) — the
 * formatter never runs, so message construction is skipped. Use freely at
 * low-volume framework boundaries; high-volume paths (e.g. `Signal.set`)
 * should use structured Context.Tag hooks instead.
 *
 * @example
 * ```ts
 * yield* logDebug("pushPath", "stax.nav", { from, to });
 * ```
 */
export const logDebug = (
  message: string,
  subsystem: Subsystem,
  data?: unknown,
): Effect.Effect<void> => {
  const log =
    data === undefined
      ? Effect.logDebug(message)
      : Effect.logDebug(message, data);
  return log.pipe(Effect.annotateLogs("subsystem", subsystem));
};

/**
 * Test whether a stack-trace line points inside `@stax-ui/core`'s own
 * sources or built output.
 *
 * Matches path segments that can only appear as a package directory:
 *
 * - `/@stax-ui/core/` — resolved via `node_modules` (installed dep, or
 *   pnpm's flat store)
 * - `/packages/core/` — workspace source or dist (this repo)
 *
 * Both are anchored with a path separator on either side, so a user
 * file named `packages/core.ts` or `stax-ui.ts` in application code
 * won't be misidentified as internal. Windows separators handled too.
 */
const isStaxCoreFrame = (line: string): boolean =>
  /[/\\]@stax-ui[/\\]core[/\\]|[/\\]packages[/\\]core[/\\]/.test(line);

/**
 * Take an `Error.stack` string and return only the user-code frames:
 *
 * - Drops the header (V8's stacks start with the literal `Error`, which
 *   reads as a real error in log output).
 * - Drops the leading contiguous run of `@stax-ui/core` frames — the
 *   `trace` wrapper itself, so the top of what we log is where the
 *   user actually called `set` / `push` / etc.
 *
 * Once a non-stax frame is seen, everything below it is kept as-is —
 * so if a user's own function is also named `set` and lives in a file
 * called `Signal.ts`, we don't strip it.
 *
 * @internal
 */
export const parseCallSite = (
  stack: string | undefined,
): string | undefined => {
  if (!stack) return undefined;
  const lines = stack.split("\n").slice(1); // drop "Error" header
  let i = 0;
  while (i < lines.length && isStaxCoreFrame(lines[i])) i++;
  const trimmed = lines.slice(i).join("\n").trimStart();
  return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * Wrap an Effect-returning method on a Signal collection so every call is
 * logged under `stax.signal` at Debug level, with the method name, its
 * arguments, and the caller's stack trace.
 *
 * Preserves the wrapped method's exact type (parameters + return type). The
 * `new Error()` capture is inside the returned function, so it runs on the
 * caller's synchronous frame — the stack top is user code, not the wrapper.
 *
 * Internal to `Signal.<Kind>.trace` implementations; not exported publicly.
 *
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const traceSignalMethod = <
  F extends (...args: any[]) => Effect.Effect<any, any, any>,
>(
  method: string,
  id: string,
  fn: F,
): F =>
  ((...args: Parameters<F>) => {
    const err = new Error();
    return Effect.gen(function* () {
      yield* logDebug(method, "stax.signal", {
        id,
        args,
        callSite: parseCallSite(err.stack),
      });
      return yield* fn(...args);
    });
  }) as F;

/**
 * Emit a warning log annotated with an Stax subsystem tag.
 *
 * Sits between {@link logDebug} (opt-in) and {@link logError} (always on
 * at Error level) — surfaces at Warning level so developers see
 * recoverable misconfigurations (an animation timeout firing, a
 * suspicious lifecycle flip) without pulling the whole Debug firehose
 * down. Routes through the standard Effect `Logger` so users can
 * raise/lower the level or ship warnings to a sink of their choice.
 *
 * @example
 * ```ts
 * yield* logWarn("animation timeout", "stax.animation", { timeout });
 * ```
 */
export const logWarn = (
  message: string,
  subsystem: Subsystem,
  data?: unknown,
): Effect.Effect<void> => {
  const log =
    data === undefined
      ? Effect.logWarning(message)
      : Effect.logWarning(message, data);
  return log.pipe(Effect.annotateLogs("subsystem", subsystem));
};

/**
 * Emit an error log annotated with an Stax subsystem tag.
 *
 * Unlike {@link logDebug}, this always emits at Error level — users see
 * it without opting into debug logging, which matches how framework
 * error paths (a reconcile handler throwing, a data provider dying) need
 * to surface. Users can route these through custom `Logger` sinks
 * (Sentry, structured logs, etc.) via the standard Effect pattern.
 *
 * @example
 * ```ts
 * yield* logError("reconcile handler failed", "stax.reconcile", {
 *   value,
 *   cause: Cause.pretty(cause),
 * });
 * ```
 */
export const logError = (
  message: string,
  subsystem: Subsystem,
  data?: unknown,
): Effect.Effect<void> => {
  const log =
    data === undefined
      ? Effect.logError(message)
      : Effect.logError(message, data);
  return log.pipe(Effect.annotateLogs("subsystem", subsystem));
};

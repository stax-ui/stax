# @stax-ui/machine

## 0.1.0

### Minor Changes

- 09a8904: feat(machine): initial release — framework-neutral state machines for Effect

  First publish of `@stax-ui/machine` as `0.1.0`.

  Declarative state machines on top of Effect: typed events, per-state payloads, single-`self` builder handle, snapshot/subscribe outputs that any reactive framework can wrap. The runtime trusts the consumer — convergent conditional cycles run cleanly (the transition chain is trampolined, no depth cap), and framework-side programmer bugs die as defects rather than ceremony on every dispatch.

  Highlights:
  - `Machine.Service` + `Machine.serviceLayer` (singleton) and `Machine.Factory` + `Machine.factoryLayer` + `.spawn(args)` (per-instance).
  - `self`: `context`, `assign`, `dispatch` / `dispatchOrFail`, `transition`, `transitionAwait`, `onExit`.
  - Per-state scopes close on transition — `Effect.forkScoped` fibers cancel, `addFinalizer`s fire, `transitionAwait` unsubscribes run.
  - Spec-level `on:` global handler map (per-state wins on conflict).
  - Spec-level `catch` block for user-defined tagged errors; `UserE` tags not caught flow on the dispatch error channel for the caller to handle inline.
  - Snapshot handle: `output`, `state`, `inState`, `canDispatch`, `availableEvents`, plus callback and `Effect`-flavored `subscribe*` siblings.
  - `awaitState` for external one-shot coordination.
  - `@stax-ui/machine/stax` subpath with `MachineReadable.*` adapters for `@stax-ui/core` Readables. `@stax-ui/core` is an **optional** peer dependency — machines without Stax don't pay for it.
  - `MalformedSpec` surfaces as a defect (`Effect.die`), not a typed error. Hitting it requires beating the type system (`as never` or dynamic key access).

  See the package README for a full walkthrough.

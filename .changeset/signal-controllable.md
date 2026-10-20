---
"@stax-ui/core": minor
---

feat(core): `Signal.controllable` for the controlled/uncontrolled component pattern

Adds `Signal.controllable(options)`, returning a `Signal<A>` that behaves two different ways depending on whether a `value` prop was passed:

- **Uncontrolled** (`value` omitted) — the returned Signal owns its own state, initialised to `defaultValue`. `.set` / `.update` commit and fire `onChange`.
- **Controlled** (`value` defined) — the returned Signal's reads delegate to the consumer's Readable, so it always reflects whatever the consumer currently holds. `.set` / `.update` fire `onChange` with the requested value and otherwise do nothing — the value only changes when the consumer updates their own state in response.

From the component's perspective it's a Signal either way: read via `.get` / `.changes`, write via `.set` / `.update`. Which writes stick is the consumer's call.

Mode is fixed at construction — stax props are evaluated once, so a prop can't flip from defined to undefined later. A plain value in controlled mode is legitimate (component is pinned read-only). Writes are serialized under a one-permit semaphore so `update((n) => n + 1)` called twice in uncontrolled mode goes 0 → 1 → 2.

Outside changes to the consumer's Readable do NOT fire `onChange` — that would invite feedback loops.

### Deprecations

`Signal.fromNullable` and `Signal.fromReactive` are deprecated in favour of `Signal.controllable`:

- `fromNullable` handed the consumer's Signal through unmodified, so the component wrote to it directly with no hook for validation or notification.
- `fromReactive`'s Readable path read the Readable once and never followed later changes — components using it with a Readable prop looked controlled but silently stopped tracking the consumer after the first render.

### Bug fix

`Signal.fromReactive`'s Readable path now subscribes to the Readable and writes each emission into the returned Signal, so a controlled-via-Readable component actually tracks the consumer. The broader design limitation (writes don't flow back to the consumer, there's no `onChange` hook) remains — switch to `Signal.controllable` for the full fix.

---
"@stax-ui/core": patch
---

Document `MergePropsCtx` as a stable extension point in both directions

`MergePropsCtx` has been exported from `@stax-ui/core` (and re-exported
from `@stax-ui/dom`) since the beginning, but its JSDoc only covered
the "provide into it" half — the `asChild` / `Form.provide` use case
where a wrapper injects `onSubmit` or similar into whichever element
sits first in its children.

The "read from it" half is equally supported, and is the right
pattern for any component that needs to interleave its own behaviour
with props a parent injected — most obviously a validated form that
runs its own validation before calling a parent-provided `onSubmit`.
Nothing about the implementation changes; this release just commits
to that pattern staying stable, and adds the guardrails to prove it.

Changes:

- Expanded the JSDoc on `MergePropsCtx` to describe both patterns
  (providing and reading), with examples, and state that the Tag's
  `Identifier` (`"MergePropsCtx"`) and Service shape
  (`Record<string, unknown>`) are part of the public API and will not
  change without a major bump.
- Added `packages/core/src/Element.test-d.ts` with three type-level
  invariants: the Service shape is exactly `Record<string, unknown>`,
  the Identifier resolves to the nominal `MergePropsCtx` class, and
  the string key is exactly `"MergePropsCtx"`. CI breaks on a quiet
  rename, loosening, or re-tagging.
- Added an **Injecting Props into Children** section to the dom
  components doc page covering both patterns with worked examples.

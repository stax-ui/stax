---
"@stax-ui/dom": patch
---

Fix `Element.bindVisible` + `hiddenValue: "until-found"`, and expose the
`$`-factory types from the package root.

**`bindVisible` + `until-found`.** When `hiddenValue` is `"until-found"`,
`manageDisplay` now defaults to `false`. The browser's find-in-page
mechanism only reveals `hidden="until-found"` content when the element is
**not** `display: none` (it relies on `content-visibility: hidden`), so the
previous default silently defeated the attribute it exists for. Explicit
`manageDisplay: true` with `"until-found"` still applies the inline rule,
for callers who want it. No change for the default `hiddenValue: ""` path.

**Package-root exports.** `HTMLAttributes`, `SVGAttributes`,
`ElementFactory`, `SVGElementFactory`, `BaseElementAttributes`,
`AttributeValue`, `EventAttributes`, and `StyleValue` are now re-exported
from `@stax-ui/dom`. They were already exported from `Element/index.ts`
but the package `exports` map only exposes the root, so downstream
libraries couldn't reach them without redeclaring the types locally.

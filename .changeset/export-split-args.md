---
"@stax-ui/dom": minor
---

Export `Element.splitArgs` and `Element.isAttrsObject`

Component authors who want their components to accept the same
`(attrs?, ...children)` / `(attrs?, children[])` call shapes as the
`$` factories now get the exact same runtime disambiguation rule
instead of having to reproduce it. Reusing it is also the only way a
user component and a `$` factory can read a given call the same way,
and if stax later adds a new kind of child it propagates everywhere
automatically.

`splitArgs` returns `attrs: undefined` (not `{}`) when no attrs were
passed, so a component author can tell "no props" from "empty props".
The `$` factories themselves default the undefined through at their
own call site, so their observable behavior is unchanged.

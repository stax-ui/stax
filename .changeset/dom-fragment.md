---
"@stax-ui/dom": minor
---

Add `$.fragment` for returning sibling elements as one Element

`container()` returns a single `Element`, so a component that needs to
produce two siblings — the canonical case being a visible interactive
element plus a hidden native `<input>` for form submission, as Base UI's
Checkbox / Switch / Radio do — has no direct way to express that.

`$.fragment(...children)` fills the gap. It returns
`Element<DocumentFragment, E, R>` whose children flatten into the parent
on append, matching `DocumentFragment.appendChild` semantics in the DOM
and `VFragment.appendChild` in SSR.

Three call shapes mirror `$.div`'s overloads minus attrs:

- `$.fragment()` — empty fragment.
- `$.fragment(...children)` — variadic, `E`/`R` channels union across
  each child the same way `$.div(...children)` does.
- `$.fragment(children)` — forwarded-array form with a single `<E, R>`
  pair, for wrapper patterns that collect children into an array first.

Example:

```ts
const Checkbox = container((props: { name: string }, children) =>
  $.fragment(
    $.span({ role: "checkbox", class: "visible" }, children),
    $.input({ type: "hidden", name: props.name, value: "yes" }),
  ),
);
```

### Design notes

- **No sentinels.** `when` / `each` / `match` use sentinel comments to
  delimit a group of nodes they swap or re-order; `$.fragment` is
  static, so no delimiter is needed. The fragment's children flatten
  into the outer parent, serialize inline in SSR, and are picked up by
  the hydration walker through the outer cursor.
- **MergePropsCtx is transparent.** Unlike `$.div`, `$.fragment` does
  not consume or clear `MergePropsCtx` — it has no DOM node of its own
  to consume the ctx into, and clearing anyway would make injected
  props silently vanish. Ambient ctx flows through to every direct
  child. For the Checkbox / Switch / Radio shape both the visible
  element and the hidden `<input>` inside the fragment adopt the
  injected prop; the hidden one picking it up alongside is harmless.
  To shield a specific child, wrap it with
  `Effect.provideService(child, MergePropsCtx, {})`.
- No attrs, no `ref` — a `DocumentFragment` has no attributes, and the
  fragment itself is empty after the parent flattens its children in.

Exposed as `$.fragment`, as a top-level `fragment` export, and the type
`FragmentFactory` is exported from the dom root.

Tests cover: variadic and forwarded-array call shapes, nested fragments
flattening, Readable children updating in place, the MergePropsCtx
transparency (including the Checkbox-style container wrapper where
injected props reach visible + hidden sibling alike), SSR serialization
without sentinels, and a full hydration round-trip including a
Checkbox-style sibling pattern.

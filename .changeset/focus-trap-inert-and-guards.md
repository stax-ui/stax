---
"@stax-ui/dom": patch
---

fix(dom): `FocusTrap` marks siblings `inert` and inserts focus guards (#174)

`FocusTrap` already caught keyboard Tab navigation at the boundaries of its container and re-focused escapes via a `focusin` listener on `document`. That's enough to _mostly_ keep sighted keyboard users inside the container — but it's not enough for a proper modal:

- **Screen-reader virtual cursors could reach outside the trap.** NVDA, JAWS, and VoiceOver let the user navigate the DOM independently of focus (arrow through headings, landmarks, etc.). Nothing marked content outside the container as unreachable, so the "trap" was a lie for AT users.
- **The `focusin` fallback caught escape _after_ it happened.** A momentary flash of focus on the wrong element, programmatic focus moves to browser chrome, and click handlers that re-focused outside the container could all slip through.

Now `FocusTrap.make`:

1. Walks the container's ancestor chain up to `document.body` and sets `inert` on every sibling along the way. Siblings the caller had already marked inert are tracked separately so the finalizer only un-sets what the trap itself set. `inert` removes an element from the accessibility tree, blocks pointer events, prevents focus, and hides it from screen-reader virtual cursors — the browser's native "this is behind a modal" primitive.
2. Inserts invisible `[tabindex=0]` sentinel guards as the container's immediate siblings. When focus lands on the before-guard the trap redirects to the last focusable in the container; the after-guard redirects to the first. This catches Tab-out of the container before focus has actually left it, including Tab from browser chrome.

Guards are marked `aria-hidden="true"` and carry a `data-stax-focus-guard` attribute so the trap's own `getFocusableElements` scanner filters them out of the Tab-wrap list.

Everything is torn down in the scope finalizer: siblings un-inerted (only the ones we set), guards removed, listeners detached, previous focus restored.

Fixes #174.

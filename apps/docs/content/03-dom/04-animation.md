---
title: "Animation"
description: "CSS-based enter/exit animations for control flow transitions, with stagger functions for lists."
order: 4
---

# Animation

Stax uses CSS-based animations for enter/exit transitions. Animations are configured on control flow primitives — `when`, `match`, `each` — so they happen automatically when the reactive state changes.

## Enter/Exit Animations

Add an `animate` option to any control flow primitive:

```typescript
import { when } from "@stax-ui/dom";

when(isOpen, {
  onTrue: () => Modal(),
  onFalse: () => $.span(),
  animate: {
    enterFrom: "opacity-0 scale-95",
    enterTo: "opacity-100 scale-100",
    exit: "fade-out",
  },
});
```

When `isOpen` becomes `true`, the entering element starts with the `enterFrom` classes, then transitions to `enterTo`. When it becomes `false`, the `exit` classes are applied and the element is removed after the animation completes.

### Animation Options

| Option | Description |
|--------|-------------|
| `enter` | Classes applied during the entire enter transition |
| `enterFrom` | Classes applied on the first frame, removed on the next |
| `enterTo` | Classes applied after `enterFrom` is removed |
| `exit` | Classes applied during the entire exit transition |
| `exitTo` | Classes applied after `exit`, element removed when transition ends |

This follows the same model as Vue and Alpine.js transitions — you define CSS classes, and Stax manages the timing.

## List Animations

Animate items entering and leaving a list:

```typescript
import { each, stagger } from "@stax-ui/dom";

each(items, {
  key: (item) => item.id,
  render: (item) => ListItem(item),
  animate: {
    enter: "slide-in",
    exit: "slide-out",
    stagger: stagger(50),  // 50ms between items
  },
});
```

When items are added, each one's enter animation starts 50ms after the previous one. When items are removed, the exit animation plays before the DOM node is removed.

## Choreographing Multi-Part Sequences

For choreography across multiple animated blocks — a hero where the logo hops in first, then the subheading fades in, then a CTA button — use `Animation.sequence`. It returns a list of `AnimationGroup` handles that gate each other in order:

```typescript
import { Animation } from "@stax-ui/dom";

const Hero = () =>
  Effect.gen(function* () {
    const [logo, subhead, cta] = yield* Animation.sequence(3);

    return yield* $.div(
      animated(
        { animate: { enterFrom: "opacity-0", enter: "logo-in", group: logo } },
        () => LogoMark(),
      ),
      animated(
        {
          animate: {
            enterFrom: "opacity-0 -translate-y-4",
            enter: "transition-all duration-300",
            enterTo: "opacity-100 translate-y-0",
            group: subhead,
          },
        },
        () => $.p("A reactive UI framework"),
      ),
      animated(
        {
          animate: {
            enterFrom: "opacity-0",
            enter: "transition-opacity duration-200",
            enterTo: "opacity-100",
            group: cta,
          },
        },
        () => Link({ href: "/docs" }, "Get started"),
      ),
    );
  });
```

The `logo` group starts immediately; `subhead` waits for `logo` to complete; `cta` waits for `subhead`. Each group is a shared handle any animated control (`animated`, `each`, `when`, `match`) can attach to via `animate.group`.

### `Animation.parallel`

Same shape as `sequence`, but all groups start at the same time. Useful nested inside a `sequence` step when you want a group of things to happen in unison, then move on:

```typescript
const [intro, [colA, colB], outro] = yield* Effect.all([
  Animation.sequence(1),
  Animation.parallel(2),
  Animation.sequence(1),
]);
```

### `Animation.skip` — advance a group without waiting

Sometimes you want a sequence step to complete without waiting for its registered animations to finish. Common cases:

- The current viewport doesn't render the animated block at all (mobile hides a desktop-only step).
- A "skip intro" button.
- `prefers-reduced-motion` is set and animations should short-circuit.
- An error branch that needs to unblock downstream steps.

`Animation.skip(group)` forces a group's completion signal to fire immediately, so the next group in the sequence unblocks:

```typescript
const [logo, chips, cta] = yield* Animation.sequence(3);

// On mobile, skip the chips step so the sequence still cascades
// through to the CTA.
if (yield* isMobile.get) {
  yield* Animation.skip(chips);
}
```

It's idempotent (safe to call multiple times) and doesn't cancel in-flight animation fibers — animations already running continue to their natural end, they just no longer gate anything downstream.

### Empty groups auto-complete

You don't always need `skip` explicitly. If a sequence step has **no** registered animations (because the branch that would use it wasn't rendered at all), the group completes automatically on the next tick and the sequence advances. So a mobile branch that conditionally omits an `animated()` block just works:

```typescript
const [logo, chips, cta] = yield* Animation.sequence(3);
return yield* $.div(
  StaxLogo({ group: logo, intro: true }),
  // On mobile, don't render the chips at all. The `chips` group has
  // no registrations, so its `_done` fires on the next tick and
  // `cta` runs anyway.
  when(isMobile, {
    onTrue: () => $.span(),
    onFalse: () => ChipRow({ group: chips }),
  }),
  CtaButton({ group: cta, intro: true }),
);
```

Reach for `Animation.skip` when the block **is** rendered but shouldn't gate downstream (reduced-motion, skip-intro, error branches). Reach for a conditional render when the block simply isn't there on this viewport.

### Nested sequences

`Animation.sequence` (and `parallel`) accept an optional `group` so they can nest inside a larger sequence:

```typescript
const [greeting, name, tagline] = yield* Animation.sequence(3);
const [firstName, lastName] = yield* Animation.sequence(2, {
  group: name,
});
// Timeline: greeting → firstName → lastName → tagline
```

The inner sequence is registered as a single virtual step on the outer `name` group — the outer chain waits for the whole inner sequence to finish before advancing to `tagline`.

## Stagger Functions

Stagger functions control the timing between animated items in a list:

```typescript
import { stagger, staggerFromCenter } from "@stax-ui/dom";
```

| Function | Description |
|----------|-------------|
| `stagger(delayMs)` | Fixed delay between items — item 0 starts immediately, item 1 at 50ms, item 2 at 100ms, etc. |
| `staggerFromCenter(delayMs)` | Items animate outward from the center of the list |

Custom stagger functions are easy to write inline — they take `(index, total)` and return a delay in milliseconds:

```typescript
animate: {
  enter: "fade-in",
  stagger: (index, total) => Math.sqrt(index) * 40,
}
```

### Example: Center-Out Stagger

```typescript
each(menuItems, {
  key: (item) => item.id,
  render: (item) => MenuItem(item),
  animate: {
    enter: "scale-in",
    stagger: staggerFromCenter(30),
  },
});
```

Items in the middle of the list animate first, then the animation ripples outward to both ends.

## CSS Setup

Stax applies classes but doesn't include any CSS. Define your transitions in your stylesheet:

```css
/* Fade in */
.fade-in {
  transition: opacity 150ms ease-in;
}

/* Slide in from below */
.slide-in {
  animation: slideIn 200ms ease-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Fade out */
.fade-out {
  transition: opacity 150ms ease-out;
  opacity: 0;
}
```

With Tailwind CSS, you can use utility classes directly:

```typescript
animate: {
  enterFrom: "opacity-0 translate-y-2",
  enter: "transition-all duration-150",
  enterTo: "opacity-100 translate-y-0",
  exit: "transition-all duration-150",
  exitTo: "opacity-0",
}
```

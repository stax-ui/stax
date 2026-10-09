# twitter-demo

## 0.0.13

### Patch Changes

- 2be6d03: chore(twitter): migrate to the Node adapter + framework-owned lifecycle

  Third follow-up in the #169 series. Collapses the twitter example's
  `src/vite-entry.ts` + `src/server.ts` into a single `src/main.ts` using
  the same `makeApp(opts)` + `AppLayer` shape as the SSR template.

  Nice demonstration of the full "backend alongside Stax" pattern in one
  place — `main.ts` now shows:

  - Stax SSR routes composed via `Platform.toHttpRoutes`
  - A plain Effect HttpRouter API route (`/api/health`) composed alongside
    the Stax routes
  - A service layer (`PostServiceLive`) provided at server scope via
    `AppLayer`

  `vite.config.ts` uses `nodeAdapter({ port: 3002, styles: [] })` — twitter
  loads its CSS via `client.ts`'s `import "./styles.css"` which Vite
  bundles into the client bundle, so no top-level `<link>` tag is needed.
  Build/dev/serve all verified end-to-end: `/` renders SSR'd, `/api/health`
  returns `{"ok":true}`, `/client.js` serves the 333 kB client bundle.

  Builds on #170.

- Updated dependencies [866f03d]
- Updated dependencies [b7bdf32]
- Updated dependencies [ce22fff]
- Updated dependencies [daaf84f]
- Updated dependencies [c89eed1]
- Updated dependencies [19f02e6]
  - @stax-ui/dom@0.10.0
  - @stax-ui/platform@0.6.0
  - @stax-ui/router@0.5.3

## 0.0.12

### Patch Changes

- Updated dependencies [4cffac7]
  - @stax-ui/dom@0.9.2
  - @stax-ui/form@0.2.5
  - @stax-ui/router@0.5.2

## 0.0.11

### Patch Changes

- Updated dependencies [bc7978e]
  - @stax-ui/dom@0.9.1
  - @stax-ui/router@0.5.1

## 0.0.10

### Patch Changes

- Updated dependencies [1d15d1a]
- Updated dependencies [6faf6a5]
- Updated dependencies [1d15d1a]
  - @stax-ui/dom@0.9.0
  - @stax-ui/router@0.5.0
  - @stax-ui/platform@0.5.5

## 0.0.9

### Patch Changes

- Updated dependencies [a8e1a51]
- Updated dependencies [a8e1a51]
  - @stax-ui/dom@0.8.0
  - @stax-ui/router@0.4.0
  - @stax-ui/platform@0.5.4

## 0.0.8

### Patch Changes

- Updated dependencies [497a8af]
  - @stax-ui/router@0.3.6

## 0.0.7

### Patch Changes

- Updated dependencies [eb6df75]
  - @stax-ui/dom@0.7.1
  - @stax-ui/router@0.3.5

## 0.0.6

### Patch Changes

- Updated dependencies [1690c6d]
  - @stax-ui/dom@0.7.0
  - @stax-ui/platform@0.5.3
  - @stax-ui/router@0.3.4

## 0.0.5

### Patch Changes

- Updated dependencies [904a41b]
  - @stax-ui/dom@0.6.0
  - @stax-ui/form@0.2.4
  - @stax-ui/router@0.3.3
  - @stax-ui/platform@0.5.2

## 0.0.4

### Patch Changes

- @stax-ui/dom@0.5.1
- @stax-ui/form@0.2.3
- @stax-ui/router@0.3.2

## 0.0.3

### Patch Changes

- Updated dependencies [6750110]
- Updated dependencies [b1f07e5]
- Updated dependencies [9142686]
  - @stax-ui/dom@0.5.0
  - @stax-ui/platform@0.5.1
  - @stax-ui/router@0.3.1
  - @stax-ui/form@0.2.2

## 0.0.2

### Patch Changes

- Updated dependencies [36b1d20]
- Updated dependencies [3065684]
- Updated dependencies [05f94f9]
- Updated dependencies [c5fd56a]
  - @stax-ui/dom@0.4.0
  - @stax-ui/router@0.3.0
  - @stax-ui/platform@0.5.0
  - @stax-ui/form@0.2.1

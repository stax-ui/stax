# Changelog

## 0.2.5

### Patch Changes

- Updated dependencies [4cffac7]
- Updated dependencies [f2b4ee0]
  - @stax-ui/core@0.7.0

## 0.2.4

### Patch Changes

- Updated dependencies [904a41b]
  - @stax-ui/core@0.6.0

## 0.2.3

### Patch Changes

- Updated dependencies [8a13e9b]
  - @stax-ui/core@0.5.0

## 0.2.2

### Patch Changes

- Updated dependencies [b1f07e5]
  - @stax-ui/core@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies [2644592]
  - @stax-ui/core@0.3.0

## 0.2.0

### Minor Changes

- 4bc4315: chore: relicense from MIT to Mozilla Public License 2.0

  Stax is now distributed under [MPL 2.0](../LICENSE). Nothing about how
  you _use_ Stax changes — commercial and proprietary projects can
  continue to depend on it freely, at any license. What changes is what
  happens when someone _modifies_ Stax's own source files: those
  modifications must be released under MPL 2.0. In short:

  - **Depend on Stax** — any license, including proprietary. No change.
  - **Fork or patch Stax itself** — those source files, and any files
    that contain Covered Software, must be released under MPL 2.0.

  MPL 2.0 is file-level copyleft. It does not "infect" downstream apps
  the way GPL / AGPL do; the boundary is at the file, not at the linked
  program. Adobe, Cisco, and Mozilla itself ship products using
  MPL 2.0-licensed components without opening the enclosing code.

  The intent: guarantee that Stax stays open source in perpetuity, and
  that no single party — including the current maintainer — can take
  the framework closed and start charging for it. Combined with the
  project's inbound = outbound contribution model (contributors retain
  copyright and license their work under the project's license), a
  future relicensing to a closed-source arrangement is effectively
  impossible once multiple contributors are involved.

  Every package version published at `0.1.x` was released under MIT and
  remains MIT forever — irrevocable per license terms. This changeset
  covers the switch to MPL 2.0 for `0.2.0` and onward. If you have
  downstream code that depends on the MIT permissive terms for a
  particular reason, you can pin to a `0.1.x` version indefinitely; the
  tags remain on npm.

### Patch Changes

- Updated dependencies [4bc4315]
  - @stax-ui/core@0.2.0

## 0.1.0

Initial release. Renamed from the `@effex/*` scope.

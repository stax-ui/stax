# Releasing

Stax uses [Changesets](https://github.com/changesets/changesets) for
version management and [npm staged publishing](https://docs.npmjs.com/staged-publishing)
with [Trusted Publishers OIDC](https://docs.npmjs.com/trusted-publishers)
for the actual publish. CI stages candidate publishes; a maintainer
approves them locally with 2FA to promote to live.

## The ritual

1. **Merge the changesets version PR.** On every push to `main` that
   has pending changesets, the release workflow opens (or updates) a
   `chore: version packages` PR. Merging it is the signal to release.

2. **CI stages the publishes.** Immediately after the version PR
   lands, the release workflow runs `pnpm release`, which calls
   `pnpm -r stage publish`. Every non-private `@stax-ui/*` package
   whose version is not yet on the registry is uploaded to npm's
   **staging area** — not visible to installers yet.

3. **Approve and ship, locally.** Pull `main`, make sure your
   working tree is clean, and run:

   ```sh
   pnpm release:ship
   ```

   This runs two steps:

   - `pnpm stage approve` — prompts you to pick which staged
     versions to promote, then asks for 2FA.
   - `node scripts/post-release.mjs` — once packages are live on
     the registry, creates a `@stax-ui/<pkg>@<version>` git tag per
     package, pushes it, and creates a GitHub Release with the
     matching CHANGELOG section as the release notes.

   The post-release script is **idempotent** and verifies each
   version is actually on the registry before tagging, so it's safe
   to re-run if approve fails midway, or if you approved some
   packages and want to tag them separately from a later batch.

4. **Cross-check.** Open the [Releases page](https://github.com/stax-ui/stax/releases)
   and the [npm org page](https://www.npmjs.com/org/stax-ui) and
   confirm everything made it.

## Edge cases

### Preview what will be tagged

```sh
node scripts/post-release.mjs --dry-run
```

Prints the candidate packages it will tag + release and the commands
it would run, without touching anything.

### I only want to tag, not approve again

If you already ran `pnpm stage approve` by hand (or on the npm
dashboard) and just need to create tags + releases for what's live:

```sh
pnpm release:tag
```

### A stage was rejected

A rejected stage never becomes a published version. The post-release
script's registry check means rejected versions never get tagged —
they just never show up in `pnpm release:tag`'s output. No cleanup
needed.

### I need to roll back a release

npm's standard [`npm unpublish`](https://docs.npmjs.com/cli/commands/npm-unpublish)
rules apply (72-hour window, no backfills). Delete the git tag and
GitHub Release with `git push origin :refs/tags/<tag>` and
`gh release delete <tag>`.

## Why staged publishing

- **Human approval gate between CI and the live registry.** A
  compromised CI secret or a wrong Trusted Publisher config can't
  silently push a bad version live.
- **2FA stays at the human, not in CI.** CI never holds any
  publishing credential; OIDC exchanges for a short-lived stage
  token, and only the maintainer with 2FA can promote stages.
- Per npmjs's current guidance for OSS packages, direct publish
  from CI is discouraged in favor of this staged flow.

## Workflow entry points

| Command | What it does |
|---|---|
| `pnpm release` | CI entry point: check versions, build, `pnpm -r stage publish`. Not for local use. |
| `pnpm release:ship` | Local entry point after merging the version PR: `pnpm stage approve && node scripts/post-release.mjs`. |
| `pnpm release:tag` | Local tag/release-only fallback when approve already happened out of band. |

#!/usr/bin/env node
// Create per-package git tags and GitHub releases for packages that
// were just published to the registry, after `pnpm stage approve`.
//
// We moved off `changeset publish` to `pnpm -r stage publish`, which
// does not emit the `New tag:` lines that `changesets/action` parses
// to create tags and releases itself. This closes that gap.
//
// Reads the latest `chore: version packages` commit for bumped
// package versions, filters to non-private workspace packages whose
// post-bump version is actually live on the registry (so partial
// approvals or not-yet-approved stages don't produce dangling tags),
// then creates annotated tags and GitHub releases with the matching
// CHANGELOG section as the body.
//
// Idempotent: skips tags that exist and releases that exist.

import { execSync, spawnSync } from "node:child_process"
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"

const dryRun = process.argv.includes("--dry-run")
if (dryRun) console.log("[dry-run] no tags, pushes, or releases will be made\n")

const sh = (cmd, opts = {}) =>
  execSync(cmd, { encoding: "utf8", ...opts }).trim()

const shWrite = (cmd, opts = {}) => {
  if (dryRun) {
    console.log(`  [dry-run] ${cmd}`)
    return ""
  }
  return sh(cmd, opts)
}

const tryShStatus = (cmd) => {
  const r = spawnSync("sh", ["-c", cmd], { encoding: "utf8" })
  return { ok: r.status === 0, stdout: r.stdout, stderr: r.stderr }
}

const versionCommit = sh(
  `git log --no-merges --grep="^chore: version packages" -1 --format=%H`,
)
if (!versionCommit) {
  console.error("No `chore: version packages` commit found.")
  process.exit(1)
}

const changedFiles = sh(
  `git show --name-only --pretty=format: ${versionCommit}`,
)
  .split("\n")
  .filter((f) => f.endsWith("package.json") && f !== "package.json")

const candidates = []
for (const file of changedFiles) {
  if (!existsSync(file)) continue
  const pkg = JSON.parse(readFileSync(file, "utf8"))
  if (pkg.private) continue
  if (!pkg.name || !pkg.version) continue
  candidates.push({ name: pkg.name, version: pkg.version, dir: dirname(file) })
}

if (candidates.length === 0) {
  console.log("No publishable packages bumped in the latest version commit.")
  process.exit(0)
}

console.log(`Candidates from ${versionCommit.slice(0, 8)}:`)
for (const { name, version } of candidates) console.log(`  ${name}@${version}`)
console.log()

const extractNotes = (changelogPath, version) => {
  if (!existsSync(changelogPath)) return `Release ${version}`
  const md = readFileSync(changelogPath, "utf8")
  const esc = version.replace(/\./g, "\\.")
  const header = new RegExp(`^## ${esc}\\s*$`, "m")
  const m = md.match(header)
  if (!m) return `Release ${version}`
  const start = m.index + m[0].length
  const rest = md.slice(start)
  const next = rest.search(/^## \d/m)
  const body = next === -1 ? rest : rest.slice(0, next)
  return body.trim() || `Release ${version}`
}

let shipped = 0
let skipped = 0
for (const { name, version, dir } of candidates) {
  const tag = `${name}@${version}`

  const onRegistry = tryShStatus(`npm view ${name}@${version} version`)
  if (!onRegistry.ok || !onRegistry.stdout.trim()) {
    console.log(`SKIP ${tag} — not on registry (stage not yet approved?)`)
    skipped++
    continue
  }

  const tagExists = tryShStatus(
    `git rev-parse --verify --quiet refs/tags/${JSON.stringify(tag)}`,
  ).ok
  if (!tagExists) {
    console.log(`TAG  ${tag}`)
    shWrite(`git tag -a ${JSON.stringify(tag)} -m ${JSON.stringify(tag)}`)
    shWrite(`git push origin ${JSON.stringify(tag)}`)
  } else {
    console.log(`TAG  ${tag} (already exists)`)
  }

  const releaseExists = tryShStatus(`gh release view ${JSON.stringify(tag)}`).ok
  if (!releaseExists) {
    console.log(`REL  ${tag}`)
    const notes = extractNotes(join(dir, "CHANGELOG.md"), version)
    if (!dryRun) {
      const dir_ = mkdtempSync(join(tmpdir(), "post-release-"))
      const notesFile = join(dir_, "notes.md")
      writeFileSync(notesFile, notes)
      sh(
        `gh release create ${JSON.stringify(tag)} --title ${JSON.stringify(tag)} --notes-file ${JSON.stringify(notesFile)}`,
      )
    } else {
      const preview = notes.split("\n").slice(0, 3).join("\n  ")
      console.log(`  [dry-run] gh release create with notes:\n  ${preview}${notes.split("\n").length > 3 ? "\n  ..." : ""}`)
    }
    shipped++
  } else {
    console.log(`REL  ${tag} (already exists)`)
  }
}

console.log()
console.log(`Done. ${shipped} shipped, ${skipped} skipped.`)

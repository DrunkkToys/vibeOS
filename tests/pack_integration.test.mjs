// SPDX-License-Identifier: MIT
// INTEGRATION: npm-packaged tarball contains required files and setup.js works.

import test from "node:test"
import assert from "node:assert/strict"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { execFileSync, spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { globSync } from "tinyglobby"
import { installVibeSkill } from "../scripts/lib/vibe-skill.mjs"

const ROOT = new URL("..", import.meta.url).pathname
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))

function createLocalPackTarball() {
  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-local-pack-"))
  const stage = join(sandbox, "package")
  mkdirSync(stage, { recursive: true })
  const positive = []
  const negative = []
  for (const entry of PKG.files || []) {
    if (typeof entry !== "string" || !entry) continue
    if (entry.startsWith("!")) negative.push(entry.slice(1))
    else positive.push(entry)
  }
  const files = new Set([
    "package.json",
    ...globSync(positive, { cwd: ROOT, dot: true, onlyFiles: true, absolute: false, ignore: negative }),
  ])
  const tgz = join(ROOT, `vibeostheog-local-pack-${Date.now()}-${process.pid}.tgz`)
  for (const rel of files) {
    const src = join(ROOT, rel)
    if (!existsSync(src)) continue
    const dst = join(stage, rel)
    mkdirSync(dirname(dst), { recursive: true })
    copyFileSync(src, dst)
  }
  execFileSync("tar", ["-czf", tgz, "-C", sandbox, "package"], { stdio: "ignore" })
  rmSync(sandbox, { recursive: true, force: true })
  return tgz
}

function packTarball() {
  const result = spawnSync("npm", ["pack", "--silent"], { cwd: ROOT, encoding: "utf8", timeout: 30000 })
  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.trim().split("\n").at(-1)
  }
  if (result.error?.code === "ENOENT" || result.status === 127) {
    return createLocalPackTarball()
  }
  throw new Error(`npm pack failed: ${result.stderr || result.stdout || result.error?.message || "unknown error"}`)
}

test("integration: /vibe skill installer writes directly under OpenCode home", () => {
  const sandbox = mkdtempSync("/tmp/vibeos-skill-home-")
  try {
    const openCodeHome = join(sandbox, ".opencode")
    const result = installVibeSkill(openCodeHome)
    assert.equal(result.path, join(openCodeHome, "skills", "vibe", "SKILL.md"))
    assert.equal(existsSync(result.path), true)
    assert.equal(existsSync(join(openCodeHome, ".opencode", "skills", "vibe", "SKILL.md")), false)
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})

// Live-reproduced gap: a real user typed "vibe diagnose cascade" in chat. The model
// had no way to know that `slot: "cascade"` is a real, richer diagnostic mode (it only
// checks `cascadeDiagnosticResults()`, which surfaces cheap-first cross-provider
// degradation among other checks) because neither the skill text nor README documented
// it -- so the model called the bare `vibe` tool with no params, got the generic status
// blurb (which doesn't cover degradation either way), and then asserted "no degradation"
// with no basis. Documenting the sub-mode closes the gap between what the tool can prove
// and what a user (or the model on their behalf) can actually reach.
test("VIBE_SKILL_BODY documents the vibe diagnose cascade sub-mode", async () => {
  const { VIBE_SKILL_BODY } = await import("../scripts/lib/vibe-skill.mjs")
  assert.match(VIBE_SKILL_BODY, /vibe diagnose cascade/, "skill text must mention the cascade diagnose sub-mode so the model knows to call it with slot: \"cascade\"")
})

// README.md already documented these three sub-modes correctly (lines 225, 283, 284, 296)
// but the model-facing skill generator did not -- the same class of gap as the
// diagnose-cascade case above: README is what a human reads, VIBE_SKILL_BODY is what the
// model actually reads to decide which tool call to make. A human-only doc fix doesn't
// help the model reach these paths.
test("VIBE_SKILL_BODY documents vibe patterns suggest, vibe axis, and vibe report savings", async () => {
  const { VIBE_SKILL_BODY } = await import("../scripts/lib/vibe-skill.mjs")
  assert.match(VIBE_SKILL_BODY, /vibe patterns suggest/, "skill text must mention patterns suggest")
  assert.match(VIBE_SKILL_BODY, /vibe axis/, "skill text must mention the axis command at all")
  assert.match(VIBE_SKILL_BODY, /vibe report savings/, "skill text must mention the report savings sub-mode")
})

test("integration: npm pack creates tarball with bin/setup.js", () => {
  const sandbox = mkdtempSync("/tmp/vibeos-pack-")
  const tgz = packTarball()
  const files = execFileSync("tar", ["-tzf", tgz], { cwd: ROOT, encoding: "utf8", timeout: 10000 }).split("\n").filter(Boolean)
  assert.ok(files.some(f => f.includes("bin/setup.js")), "tarball must contain bin/setup.js, got: " + files.slice(0, 5).join(", "))
  assert.ok(files.some(f => f.includes("scripts/deploy.mjs")), "tarball must contain scripts/deploy.mjs")
  assert.ok(files.some(f => f.includes("scripts/lib/opencode-homes.mjs")), "tarball must contain scripts/lib/opencode-homes.mjs")
  // The universal /vibe skill is generated from VIBE_SKILL_BODY at deploy time
  // (single source of truth), not shipped as a static pre-built copy — the
  // tarball just needs the generator.
  assert.ok(files.some(f => f.includes("scripts/lib/vibe-skill.mjs")), "tarball must contain the /vibe skill generator")
  rmSync(tgz, { force: true })
  rmSync(sandbox, { recursive: true, force: true })
})

test("integration: packed setup.js has no readline/confirm prompt logic", () => {
  const sandbox = mkdtempSync("/tmp/vibeos-pack-")
  const tgz = packTarball()
  execFileSync("tar", ["-xzf", tgz, "-C", sandbox], { encoding: "utf8", timeout: 10000 })
  const pkgDir = join(sandbox, "package")
  const packedSetup = readFileSync(join(pkgDir, "bin", "setup.js"), "utf8")
  for (const pat of ["createInterface", "question(", "[y/N]", "[Y/n]", "confirm"]) {
    assert.equal(packedSetup.includes(pat), false, "packed setup.js must not contain: " + pat)
  }
  rmSync(sandbox, { recursive: true, force: true })
  rmSync(tgz, { force: true })
})

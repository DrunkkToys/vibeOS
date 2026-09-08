// SPDX-License-Identifier: MIT
//
// Which build the run measured.
//
// A run that cannot name its bundle cannot support a claim about which fix moved
// a number. run20 and run21 loaded the main checkout's dist/vibeOS.js, which has
// been rebuilt since, so nothing they measured can be attributed to a commit.
// The sha256 is the identity; the commit is a label for it, and only a valid one
// when the worktree that produced it was clean.
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname } from "node:path"

function git(dir, args) {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
}

export function readBundleProvenance(bundlePath) {
  if (!bundlePath || !existsSync(bundlePath)) return { bundle: bundlePath || null, error: "bundle not found" }
  const content = readFileSync(bundlePath)
  const out = {
    bundle: bundlePath,
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: content.length,
    mtime: new Date(statSync(bundlePath).mtimeMs).toISOString(),
    commit: null,
    subject: null,
    dirty: null,
  }
  const dir = dirname(bundlePath)
  try {
    out.commit = git(dir, ["rev-parse", "HEAD"])
    out.subject = git(dir, ["log", "-1", "--format=%s"])
    // A dirty worktree means the commit is a neighbourhood, not an identity: the
    // bundle may contain changes no commit carries.
    out.dirty = git(dir, ["status", "--porcelain"]).length > 0
  } catch {
    out.commit = null
    out.subject = null
    out.dirty = null
  }
  return out
}

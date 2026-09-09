// SPDX-License-Identifier: MIT
//
// What a killed turn leaves behind. `opencode run --format json` does not stream
// its output, so a SIGKILL takes the whole transcript with it: stdout bytes, tool
// calls, mutating calls all read zero for a turn that rewrote the repository. The
// files it wrote are the one record the kill cannot reach.
//
// Never fails a run: an unreadable tree hashes to null, and null means "unknown",
// which the retry rule treats as "do not retry".
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"

const SKIP = new Set(["node_modules", ".git"])

function walk(dir, root, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, root, out)
    else if (entry.isFile()) out.push(full)
  }
}

export function hashTree(dir) {
  try {
    const files = []
    walk(dir, dir, files)
    // Sorted by path so the hash depends on the contents of the tree and not on
    // the order the filesystem happened to return them in.
    files.sort()
    const h = createHash("sha256")
    for (const f of files) {
      h.update(relative(dir, f).split(sep).join("/"))
      h.update("\0")
      h.update(String(statSync(f).size))
      h.update("\0")
      h.update(readFileSync(f))
      h.update("\0")
    }
    return h.digest("hex")
  } catch {
    return null
  }
}

// null on either side means the tree could not be read; the caller must treat
// that as unknown, never as unchanged.
export function treeChangedBetween(before, after) {
  if (!before || !after) return null
  return before !== after
}

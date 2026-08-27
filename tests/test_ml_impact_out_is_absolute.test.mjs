// SPDX-License-Identifier: MIT
//
// ml-impact passes trial.home to the plugin as VIBEOS_HOME. A relative --out makes
// trial.home relative, and the plugin process runs with cwd = the trial project dir
// while the harness runs with cwd = the repo root. The same relative string then names
// two different directories: the plugin writes its whole state tree under
// <proj>/<out>/trials/<trial>/home, and collectEvidence reads <root>/<out>/trials/
// <trial>/home and finds an empty cascade-audit.jsonl. Observed live on .ml-run2:
// 48 audit rows (24 chat-params) in the project copy, 0 rows in the one that was read.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname, isAbsolute } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SRC = readFileSync(join(ROOT, "scripts/e2e/ml-impact.mjs"), "utf8")

test("--out is resolved to an absolute path", () => {
  const line = SRC.split("\n").find((l) => l.includes("const OUT ="))
  assert.ok(line, "ml-impact must define OUT")
  assert.match(
    line,
    /resolve\(/,
    "a relative --out becomes a relative VIBEOS_HOME, which names a different directory " +
      "in the plugin (cwd=trial proj) than in the harness (cwd=repo root)",
  )
})

test("VIBEOS_HOME handed to a trial is absolute", async () => {
  const { resolve } = await import("node:path")
  // Mirror the resolution the harness performs, with the exact flag that produced the split.
  const out = resolve(ROOT, ".ml-run2")
  const home = join(out, "trials", "vibeqmax-0", "home")
  assert.ok(isAbsolute(home), "trial.home must be absolute before it is exported as VIBEOS_HOME")
})

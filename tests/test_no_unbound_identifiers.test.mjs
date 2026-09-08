// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
//
// 40 source files carry // @ts-nocheck, so `tsc --noEmit` cannot see an
// identifier that was never bound. eslint's no-undef is the only floor left.
// Every hit here is a ReferenceError waiting on a live turn: swallowed by a
// catch, reported through a channel nothing reads, or not caught at all.
import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

test("no source file references an identifier that was never bound", () => {
  let raw = ""
  try {
    raw = execFileSync("npx", ["eslint", "src/", "-f", "json"], {
      cwd: repoRoot,
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch (err) {
    // eslint exits non-zero when it reports errors; the JSON is still on stdout.
    raw = err.stdout || ""
    if (!raw) throw err
  }

  const offenders = []
  for (const file of JSON.parse(raw)) {
    for (const msg of file.messages) {
      if (msg.ruleId !== "no-undef") continue
      offenders.push(`${file.filePath.replace(repoRoot + "/", "")}:${msg.line} ${msg.message}`)
    }
  }

  assert.deepEqual(offenders, [], `unbound identifiers:\n${offenders.join("\n")}`)
})

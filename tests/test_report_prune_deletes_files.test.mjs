// SPDX-License-Identifier: MIT
// Contract: when the reports index is pruned down to its 200-entry cap,
// the underlying `${id}.json` files for the dropped (over-cap) entries
// must actually be deleted from disk -- not just removed from index.json.
// Live observation (2026-07-12): $VIBEOS_HOME/reports/ had 7688 files on
// disk (30MB) while report-list correctly showed only 200, because the
// cap-based prune step only trimmed the index array and never called
// rmSync for the entries it dropped (unlike the >90-day-old branch, which
// did delete files). This reproduces that gap and proves the fix.

import { describe, it, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readdirSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const home = mkdtempSync(join(tmpdir(), "vibeos-report-prune-"))
mkdirSync(join(home, ".claude"), { recursive: true })
process.env.HOME = home
process.env.VIBEOS_HOME = join(home, ".claude")

const { saveReport } = await import("../src/lib/reporting.js?t=" + Date.now())

after(() => {
  try { rmSync(home, { recursive: true, force: true }) } catch {}
})

describe("reports prune deletes over-cap files from disk, not just the index", () => {
  it("should not leave orphaned .json files once the 200-entry cap is exceeded", () => {
    for (let i = 0; i < 210; i++) {
      saveReport({
        type: "manual",
        summary: `Prune test report #${i}`,
        fingerprint: "fp-prune-test",
      })
    }
    const reportsDir = join(home, ".claude", "reports")
    const files = readdirSync(reportsDir).filter((f) => f.endsWith(".json") && f !== "index.json")
    assert.ok(files.length <= 200, `expected at most 200 report files on disk after pruning, found ${files.length}`)
  })
})

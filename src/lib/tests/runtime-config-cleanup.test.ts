import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readdirSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const STUB = JSON.stringify({ model: "deepseek/deepseek-v4-flash", $schema: "https://opencode.ai/config.json" })

function backupsIn(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.startsWith("config.json.vibeos-bak-"))
}

describe("cleanupLegacyOpenCodeConfigFiles", () => {
  it("renames a legacy config.json stub to a single backup", async () => {
    const { cleanupLegacyOpenCodeConfigFiles } = await import("../runtime-config.js?cleanup=" + Date.now())
    const dir = mkdtempSync(join(tmpdir(), "vibeos-cfg-"))
    const cfg = join(dir, "config.json")
    writeFileSync(cfg, STUB, "utf-8")

    const cleaned = cleanupLegacyOpenCodeConfigFiles(dir, { includeHome: false })
    assert.equal(cleaned.length, 1)
    assert.equal(existsSync(cfg), false, "stub is moved aside")
    assert.equal(backupsIn(dir).length, 1)
  })

  it("does not accumulate backups when the stub is regenerated every turn", async () => {
    const { cleanupLegacyOpenCodeConfigFiles } = await import("../runtime-config.js?cleanup=" + Date.now() + "-2")
    const dir = mkdtempSync(join(tmpdir(), "vibeos-cfg-"))
    const cfg = join(dir, "config.json")

    // Simulate three consecutive turns: each turn something recreates the stub,
    // then the hook runs cleanup. Backups must NOT pile up across turns.
    for (let turn = 0; turn < 3; turn++) {
      writeFileSync(cfg, STUB, "utf-8")
      cleanupLegacyOpenCodeConfigFiles(dir, { includeHome: false })
    }

    assert.ok(backupsIn(dir).length <= 1, `expected at most one retained backup, found ${backupsIn(dir).length}`)
  })
})

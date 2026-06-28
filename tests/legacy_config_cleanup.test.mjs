import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-legacy-config-"))
process.env.HOME = sandbox
process.env.VIBEOS_HOME = join(sandbox, ".claude")

mkdirSync(join(sandbox, ".claude"), { recursive: true })
mkdirSync(join(sandbox, ".opencode"), { recursive: true })
writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
  selection: { enabled: true, active_slot: "cheap" },
  trinity: {
    cheap: { oc: "opencode/big-pickle" },
    medium: { oc: "deepseek/deepseek-v4-flash" },
    brain: { oc: "deepseek/deepseek-v4-pro" },
  },
}, null, 2) + "\n")
writeFileSync(join(sandbox, ".claude/delegation-state.json"), JSON.stringify({ lifetime: { warn_count: 0 }, sessions: {} }, null, 2) + "\n")

const projectDir = join(sandbox, "project")
mkdirSync(projectDir, { recursive: true })
mkdirSync(join(sandbox, ".config/opencode"), { recursive: true })

const projectConfig = join(projectDir, "config.json")
const homeConfig = join(sandbox, "config.json")
const safeConfig = join(projectDir, "opencode.json")
const opencodeConfig = join(sandbox, ".config/opencode/opencode.json")

writeFileSync(projectConfig, JSON.stringify({ model: "opencode/big-pickle" }, null, 2) + "\n")
writeFileSync(homeConfig, JSON.stringify({ model: "opencode/big-pickle", $schema: "https://opencode.ai/config.json" }, null, 2) + "\n")
writeFileSync(safeConfig, JSON.stringify({ model: "deepseek/deepseek-v4-flash" }, null, 2) + "\n")
writeFileSync(opencodeConfig, JSON.stringify({
  model: "deepseek/deepseek-v4-flash",
  provider: { deepseek: { models: { "deepseek-v4-flash": {} } } },
}, null, 2) + "\n")

const { DelegationEnforcer } = await import("../dist/vibeOS.js?t=" + Date.now())

test("system.transform cleans up legacy config.json stubs before the next turn", async () => {
  const hooks = await DelegationEnforcer({ client: {}, directory: projectDir })
  await hooks["experimental.chat.system.transform"]({}, { system: [] })

  assert.equal(existsSync(projectConfig), false, "project config.json should be moved aside")
  assert.equal(existsSync(homeConfig), false, "home config.json should be moved aside")
  assert.equal(existsSync(safeConfig), true, "opencode.json should remain untouched")
  const backups = [
    ...readdirSync(projectDir).map((name) => join(projectDir, name)),
    ...readdirSync(sandbox).map((name) => join(sandbox, name)),
  ].filter((path) => path.includes(".vibeos-bak-"))
  assert.equal(backups.length, 2, "should back up both legacy files")
  for (const backup of backups) {
    assert.ok(existsSync(backup), `backup missing: ${backup}`)
    const text = readFileSync(backup, "utf8")
    assert.ok(text.includes("opencode/big-pickle"), `backup should preserve content: ${backup}`)
  }
})

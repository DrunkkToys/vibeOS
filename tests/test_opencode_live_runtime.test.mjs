import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import assert from "node:assert"

function resolveOpenCodeBinary() {
  const homeBin = join(homedir(), ".opencode", "bin", "opencode")
  if (existsSync(homeBin)) return homeBin
  const probe = spawnSync("bash", ["-lc", "command -v opencode"], { encoding: "utf8" })
  const found = String(probe.stdout || "").trim()
  return found && existsSync(found) ? found : ""
}

const opencodeBin = resolveOpenCodeBinary()

if (!opencodeBin) {
  test.skip("live OpenCode runtime is unavailable on this machine", () => {})
} else {
  test("live OpenCode runtime loads vibeOS and exposes reality-check", () => {
    const config = spawnSync(opencodeBin, ["debug", "config"], { encoding: "utf8" })
    assert.equal(config.status, 0, config.stderr || config.stdout)
    const parsed = JSON.parse(String(config.stdout || "").trim())

    assert.ok(Array.isArray(parsed.plugin), "plugin list exists")
    assert.ok(parsed.plugin.some((p) => String(p).includes("vibeOS.js")), "vibeOS plugin is loaded")
    assert.ok(Array.isArray(parsed.plugin_origins), "plugin origins exist")
    assert.ok(parsed.plugin_origins.some((p) => String(p.spec || "").includes("vibeOS.js")), "vibeOS origin is resolved")

    const info = spawnSync(opencodeBin, ["debug", "info"], { encoding: "utf8" })
    assert.equal(info.status, 0, info.stderr || info.stdout)
    assert.ok(String(info.stdout || "").includes("plugins:"), "debug info lists plugins")
    assert.ok(String(info.stdout || "").includes("vibeOS.js"), "debug info includes vibeOS plugin")

    const startup = spawnSync(opencodeBin, ["debug", "startup"], { encoding: "utf8" })
    assert.equal(startup.status, 0, startup.stderr || startup.stdout)
    assert.ok(Number(String(startup.stdout || "").trim()) > 0, "startup timing is returned")
  })
}

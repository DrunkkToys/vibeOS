import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"

test("MCP dashboard stays disabled by default even when a live stale runtime exists", () => {
  const sandbox = mkdtempSync(join(tmpdir(), "vibeos-mcp-default-"))
  const vibeHome = join(sandbox, ".claude")
  mkdirSync(vibeHome, { recursive: true })
  writeFileSync(join(vibeHome, "mcp-runtime.json"), JSON.stringify({
    port: 52000,
    baseUrl: "http://127.0.0.1:52000",
    pid: process.pid,
  }))
  writeFileSync(join(vibeHome, "model-tiers.json"), JSON.stringify({
    selection: { mcp_port: 52000 },
  }))

  const script = `
    process.env.HOME = ${JSON.stringify(sandbox)};
    process.env.VIBEOS_HOME = ${JSON.stringify(vibeHome)};
    delete process.env.VIBEOS_MCP_PORT;
    const mod = await import(${JSON.stringify(new URL("../dist-ts/index.js", import.meta.url).href)} + "?mcp-default=" + Date.now());
    console.log(mod._loadMcpPort());
  `
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
  })
  assert.equal(child.status, 0, child.stderr || child.stdout)
  assert.equal(child.stdout.trim(), "0")
})

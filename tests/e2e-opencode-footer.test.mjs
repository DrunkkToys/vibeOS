// Real OpenCode E2E. Deliberately opt-in: it makes a model request and needs
// an explicit auth-file path, so CI remains hermetic.
import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const enabled = process.env.VIBEOS_E2E_OPENCODE === "1"
const authFile = process.env.VIBEOS_E2E_AUTH_FILE || ""

test("OpenCode completion paints exactly one footer without touching its config", { skip: !enabled }, () => {
  assert.ok(authFile, "set VIBEOS_E2E_AUTH_FILE to an OpenCode auth.json")
  const root = mkdtempSync(join(tmpdir(), "vibeos-opencode-e2e-"))
  const home = join(root, "home")
  const configDir = join(home, ".config", "opencode")
  const dataDir = join(home, ".local", "share", "opencode")
  const project = join(root, "project")
  const bundle = join(root, "vibeOS.js")
  try {
    mkdirSync(configDir, { recursive: true })
    mkdirSync(dataDir, { recursive: true })
    mkdirSync(project, { recursive: true })
    copyFileSync(authFile, join(dataDir, "auth.json"))
    const rootDir = resolve(import.meta.dirname, "..")
    const esbuild = join(rootDir, "node_modules", ".bin", "esbuild")
    const build = spawnSync(esbuild, [
      "src/index.ts", "--bundle", "--platform=node", "--format=esm", "--target=node22",
      "--external:node:*", `--outfile=${bundle}`,
    ], { cwd: rootDir, encoding: "utf8" })
    assert.equal(build.status, 0, build.stderr)
    const config = { plugin: [bundle] }
    writeFileSync(join(configDir, "opencode.json"), JSON.stringify(config))
    const result = spawnSync("opencode", ["run", "--model", "opencode/big-pickle", "--format", "json", "Respond with exactly: E2E_OK"], {
      cwd: project,
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, HOME: home, VIBEOS_HOME: join(home, ".vibeos") },
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.match(result.stdout, /E2E_OK/)
    assert.equal((result.stdout.match(/— [^\n]+ —/g) || []).length, 1)
    const finalConfig = JSON.parse(readFileSync(join(configDir, "opencode.json"), "utf8"))
    assert.deepEqual(finalConfig.plugin, config.plugin)
    assert.equal(finalConfig.model, undefined)
    assert.equal(finalConfig.default_agent, undefined)
    assert.equal(finalConfig.agent, undefined)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

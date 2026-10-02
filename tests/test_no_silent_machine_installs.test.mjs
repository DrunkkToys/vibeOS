// SPDX-License-Identifier: MIT
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const PLIST = ["Library", "LaunchAgents", "com.vibeos.opencode-event-retention.plist"]

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), "vibeos-no-silent-install-"))
  const ocHome = join(home, ".opencode")
  const env = {
    ...process.env,
    HOME: home,
    VIBEOS_OPENCODE_HOME: ocHome,
    PATH: dirname(process.execPath),
  }
  delete env.VIBEOS_INSTALL_RETENTION
  delete env.VIBEOS_INSTALL_CRON
  return { home, ocHome, env }
}

function run(script, env) {
  return spawnSync(process.execPath, [join(ROOT, "scripts", script)], { cwd: ROOT, env, encoding: "utf8", timeout: 180000 })
}

test("building the bundle does not install vibeOS into the OpenCode home", () => {
  const { home, ocHome, env } = sandbox()
  try {
    const res = run("build-bundle.mjs", { ...env, PATH: process.env.PATH })
    assert.equal(res.status, 0, res.stderr)
    assert.ok(existsSync(join(ROOT, "dist", "vibeOS.js")))
    assert.equal(existsSync(join(ocHome, "plugins", "vibeOS.js")), false, "build-bundle wrote ~/.opencode/plugins/vibeOS.js")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("deploy does not register a background LaunchAgent unless asked", () => {
  const { home, env } = sandbox()
  try {
    const res = run("deploy.mjs", env)
    assert.equal(res.status, 0, res.stderr)
    assert.equal(existsSync(join(home, ...PLIST)), false, "deploy installed the retention LaunchAgent without opt-in")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("deploy registers the retention LaunchAgent only with VIBEOS_INSTALL_RETENTION=1", { skip: process.platform !== "darwin" }, () => {
  const { home, env } = sandbox()
  try {
    const res = run("deploy.mjs", { ...env, VIBEOS_INSTALL_RETENTION: "1" })
    assert.equal(res.status, 0, res.stderr)
    assert.ok(existsSync(join(home, ...PLIST)))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("deploy leaves other plugins in the OpenCode plugin dir untouched", () => {
  const { home, ocHome, env } = sandbox()
  try {
    const plugins = join(ocHome, "plugins")
    mkdirSync(join(plugins, "lib"), { recursive: true })
    mkdirSync(join(plugins, "utils"), { recursive: true })
    writeFileSync(join(plugins, "someone-else.ts"), "export default {}\n")
    writeFileSync(join(plugins, "lib", "helper.js"), "export const x = 1\n")
    writeFileSync(join(plugins, "utils", "util.ts"), "export const y = 2\n")
    const res = run("deploy.mjs", env)
    assert.equal(res.status, 0, res.stderr)
    assert.ok(existsSync(join(plugins, "vibeOS.js")), "deploy did not install vibeOS.js")
    assert.equal(readFileSync(join(plugins, "someone-else.ts"), "utf8"), "export default {}\n")
    assert.ok(existsSync(join(plugins, "lib", "helper.js")), "deploy deleted plugins/lib")
    assert.ok(existsSync(join(plugins, "utils", "util.ts")), "deploy deleted plugins/utils")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

function fakeCrontab(home) {
  const bin = join(home, "fake-bin")
  mkdirSync(bin, { recursive: true })
  const log = join(home, "crontab-calls.log")
  writeFileSync(join(bin, "crontab"), `#!/bin/sh\necho "$@" >> "${log}"\ncat > /dev/null\n`, { mode: 0o755 })
  return { path: `${bin}:${dirname(process.execPath)}:/bin:/usr/bin`, log }
}

test("deploy does not touch the user's crontab unless asked", { skip: process.platform === "win32" }, () => {
  const { home, env } = sandbox()
  try {
    const cron = fakeCrontab(home)
    const res = run("deploy.mjs", { ...env, PATH: cron.path })
    assert.equal(res.status, 0, res.stderr)
    assert.equal(existsSync(cron.log), false, "deploy called crontab without opt-in")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("deploy installs the nightly cron only with VIBEOS_INSTALL_CRON=1", { skip: process.platform === "win32" }, () => {
  const { home, env } = sandbox()
  try {
    const cron = fakeCrontab(home)
    const res = run("deploy.mjs", { ...env, PATH: cron.path, VIBEOS_INSTALL_CRON: "1" })
    assert.equal(res.status, 0, res.stderr)
    assert.ok(existsSync(cron.log), "deploy did not install the cron with opt-in")
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

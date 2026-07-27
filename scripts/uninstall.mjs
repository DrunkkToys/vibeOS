#!/usr/bin/env node
// vibeOS uninstall — mirrors scripts/deploy.mjs in reverse.
// Removes the plugin entry, vibe tier agents, default_agent, plugin files,
// the launch agent, the nightly cron, and the VIBEOS_HOME runtime dir.

import { execFileSync, execSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import { resolveOpenCodeHomes } from "./lib/opencode-homes.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")

const VIBE_AGENTS = ["vibe", "vibe-cheap", "vibe-medium", "vibe-brain"]
const LAUNCH_AGENT_LABEL = "com.vibeos.opencode-event-retention"
const CRON_MARKER = "# vibeOS nightly pricing sync"

function writeLine(text = "") {
  process.stdout.write(text + "\n")
}

function readJson(path) {
  if (!existsSync(path)) return {}
  try {
    const raw = readFileSync(path, "utf8")
    const cleaned = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
    const parsed = JSON.parse(cleaned)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeJsonAtomic(path, value) {
  const dir = dirname(path)
  if (!existsSync(dir)) return
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n")
  renameSync(tmp, path)
}

function unregisterFromOpenCodeConfig(home) {
  const ocConfigPath = join(home, "opencode.json")
  if (!existsSync(ocConfigPath)) return false
  let config = readJson(ocConfigPath)
  let changed = false
  if (Array.isArray(config.plugin)) {
    const before = config.plugin.length
    config.plugin = config.plugin.filter((entry) => {
      const p = typeof entry === "string" ? entry : String(entry?.path || entry?.ref || "")
      return !p || /vibeOS\.js$/.test(p) === false
    })
    if (config.plugin.length === 0) delete config.plugin
    if (config.plugin?.length !== before) changed = true
  }
  if (config.agent && typeof config.agent === "object") {
    for (const name of VIBE_AGENTS) {
      if (config.agent[name]) {
        delete config.agent[name]
        changed = true
      }
    }
    if (Object.keys(config.agent).length === 0) delete config.agent
  }
  if (config.default_agent && VIBE_AGENTS.includes(String(config.default_agent))) {
    delete config.default_agent
    changed = true
  }
  if (changed) writeJsonAtomic(ocConfigPath, config)
  return changed
}

function removePluginFiles(home) {
  const pluginDir = join(home, "plugins")
  const targets = [
    join(pluginDir, "vibeOS.js"),
    join(pluginDir, "vibeOS.js.deploying"),
    join(pluginDir, "vibeOS.js.tmp"),
    join(pluginDir, "assets"),
    join(pluginDir, ".env.production"),
  ]
  for (const t of targets) {
    if (existsSync(t)) {
      try { rmSync(t, { recursive: true, force: true }) } catch {}
    }
  }
}

function unloadLaunchAgent() {
  const plistPath = join(homedir(), "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`)
  if (!existsSync(plistPath)) return false
  try {
    const domain = `gui/${process.getuid?.() || 0}`
    try { execFileSync("launchctl", ["bootout", domain, plistPath], { stdio: "ignore" }) } catch {}
  } catch {}
  try { rmSync(plistPath, { force: true }) } catch {}
  return true
}

function removeCron() {
  try {
    const current = execSync("crontab -l 2>/dev/null || true", { encoding: "utf8" })
    if (!current.includes(CRON_MARKER)) return false
    const lines = current.split("\n").filter((line) => line.trim() !== CRON_MARKER && !line.includes("scripts/nightly-experiment-cron.sh"))
    const next = lines.join("\n").trim() + "\n"
    execSync("crontab -", { input: next, encoding: "utf8" })
    return true
  } catch {
    return false
  }
}

function removeVibeOSHome() {
  const vibeHome = process.env.VIBEOS_HOME?.trim() || join(homedir(), "Library", "Application Support", "ai.opencode.desktop", "vibeOS")
  if (!existsSync(vibeHome)) return false
  try { rmSync(vibeHome, { recursive: true, force: true }) } catch {}
  return true
}

function unlinkGlobalPackage() {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
    const name = pkg?.name
    if (!name) return false
    try { execFileSync("npm", ["unlink", "-g", name], { stdio: "ignore", cwd: ROOT }) } catch {}
    return true
  } catch {
    return false
  }
}

writeLine()
writeLine("vibeOS — uninstall")
writeLine()

let didSomething = false
for (const home of resolveOpenCodeHomes({ cwd: process.cwd() })) {
  if (unregisterFromOpenCodeConfig(home)) {
    writeLine(`✓ unregistered vibeOS from ${home}/opencode.json`)
    didSomething = true
  }
  removePluginFiles(home)
  writeLine(`✓ removed plugin files from ${home}/plugins/`)
  didSomething = true
}

if (unloadLaunchAgent()) {
  writeLine(`✓ unloaded launch agent ${LAUNCH_AGENT_LABEL}`)
  didSomething = true
}
if (removeCron()) {
  writeLine("✓ removed nightly pricing cron")
  didSomething = true
}
if (removeVibeOSHome()) {
  writeLine(`✓ removed VIBEOS_HOME runtime state`)
  didSomething = true
}
if (unlinkGlobalPackage()) {
  writeLine("✓ unlinked global npm package")
  didSomething = true
}

writeLine()
if (didSomething) {
  writeLine("vibeOS uninstall complete. Restart OpenCode to apply.")
} else {
  writeLine("Nothing to do — vibeOS was already uninstalled.")
}
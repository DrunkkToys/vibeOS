#!/usr/bin/env node
// vibeOS uninstall — mirrors scripts/deploy.mjs in reverse.
// Removes the plugin entry, vibe tier agents, default_agent, plugin files,
// the /vibe skill, the launch agent, the nightly cron, the global npm link,
// every known runtime state dir (VIBEOS_HOME, ~/.vibetheog, ~/.vibeos,
// desktop vibeOS, debug artifacts), vibe-named state files in ~/.claude,
// the project-level opencode.json registrations, and stray deploy artifacts.
// Leaves ~/.claude, ~/.config/opencode and ~/.opencode/bin/opencode intact so
// OpenCode itself keeps working and a reinstall starts from a blank slate.

import { execFileSync, execSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync, mkdirSync } from "node:fs"
import { join, dirname, basename, resolve } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import { resolveOpenCodeHomes } from "./lib/opencode-homes.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")
const HOME = homedir()

const VIBE_AGENTS = ["vibe", "vibe-cheap", "vibe-medium", "vibe-brain"]
const VIBE_DEFAULT_AGENT_RE = /^vibe$|^vibe-(cheap|medium|brain)$/
const LAUNCH_AGENT_LABEL = "com.vibeos.opencode-event-retention"
const CRON_MARKER = "# vibeOS nightly pricing sync"

function writeLine(text = "") {
  process.stdout.write(text + "\n")
}

// Strip JSONC comments without touching URLs inside string literals.
function stripJsonComments(raw) {
  let out = ""
  let inString = false
  let i = 0
  while (i < raw.length) {
    const ch = raw[i]
    const next = raw[i + 1]
    if (inString) {
      out += ch
      if (ch === "\\") { out += next || ""; i += 2; continue }
      if (ch === '"') inString = false
      i++
      continue
    }
    if (ch === '"') { inString = true; out += ch; i++; continue }
    if (ch === "/" && next === "/") {
      while (i < raw.length && raw[i] !== "\n") i++
      continue
    }
    if (ch === "/" && next === "*") {
      i += 2
      while (i < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) i++
      i += 2
      continue
    }
    out += ch
    i++
  }
  return out
}

function readJson(path) {
  if (!existsSync(path)) return {}
  try {
    const raw = readFileSync(path, "utf8")
    const cleaned = stripJsonComments(raw).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
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
      return !p || !p.includes("vibeOS")
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
  if (config.default_agent && VIBE_DEFAULT_AGENT_RE.test(String(config.default_agent))) {
    delete config.default_agent
    changed = true
  }
  if (changed) writeJsonAtomic(ocConfigPath, config)
  return changed
}

function stripVibeFromConfig(path) {
  return unregisterFromOpenCodeConfig(dirname(path))
}

// Known VIBEOS_HOME locations. Never deletes ~/.claude wholesale — only the
// vibe-named files inside it are removed separately.
function collectStateRoots() {
  const roots = new Set()
  const explicit = process.env.VIBEOS_HOME?.trim()
  const claudeHome = join(HOME, ".claude")
  if (explicit && explicit !== claudeHome) roots.add(explicit)
  for (const p of [
    join(HOME, ".vibetheog"),
    join(HOME, ".vibeos"),
    join(HOME, ".vibeOS"),
    join(HOME, "Library", "Application Support", "ai.opencode.desktop", "vibeOS"),
  ]) {
    roots.add(p)
  }
  return [...roots]
}

function removeStateDirs() {
  let removed = 0
  for (const root of collectStateRoots()) {
    if (existsSync(root)) {
      try { rmSync(root, { recursive: true, force: true }) } catch {}
      removed++
    }
  }
  return removed
}

function removeDebugArtifacts() {
  let removed = 0
  for (const name of readdirSync(HOME)) {
    if (name.startsWith(".vibelm-debug") || name.startsWith(".vibeos-")) {
      const target = join(HOME, name)
      try { rmSync(target, { recursive: true, force: true }) } catch {}
      removed++
    }
  }
  return removed
}

function removeClaudeVibeFiles() {
  const claudeHome = join(HOME, ".claude")
  const targets = [
    ".vibeOS-locks",
    "model-tiers.json",
    "savings-ledger.jsonl",
    "delegation-state.json",
    "blackbox-state.json",
    "project-states.json",
    ".flow-todo-queue.jsonl",
    ".enforcement-cooldown.jsonl",
    ".env.production",
    ".env.alpha",
    "pricing-sync-cron.log",
    "reports",
  ].map((p) => join(claudeHome, p))
  let removed = 0
  for (const t of targets) {
    if (existsSync(t)) {
      try { rmSync(t, { recursive: true, force: true }) } catch {}
      removed++
    }
  }
  return removed
}

function removePluginFiles(home) {
  const pluginDir = join(home, "plugins")
  const targets = [
    join(pluginDir, "vibeOS.js"),
    join(pluginDir, "vibeOS.js.deploying"),
    join(pluginDir, "vibeOS.js.tmp"),
    join(pluginDir, "assets"),
    join(pluginDir, ".env.production"),
    join(pluginDir, "opencode-event-retention.mjs"),
    join(pluginDir, "opencode-retention.log"),
  ]
  for (const t of targets) {
    if (existsSync(t)) {
      try { rmSync(t, { recursive: true, force: true }) } catch {}
    }
  }
}

function removeSkills(home) {
  const targets = [
    join(home, "skills", "vibe"),
    join(home, ".opencode", "skills", "vibe"),
  ]
  for (const t of targets) {
    if (existsSync(t)) {
      try { rmSync(t, { recursive: true, force: true }) } catch {}
    }
  }
}

function pruneEmptyDirs(home) {
  for (const rel of ["plugins", "skills"]) {
    const dir = join(home, rel)
    if (!existsSync(dir)) continue
    try {
      const entries = readdirSync(dir)
      if (entries.length === 0) rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
}

function unloadLaunchAgent() {
  const plistPath = join(HOME, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`)
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

function looksLikeVibeArtifact(dir) {
  const ocConfigPath = join(dir, "opencode.json")
  if (existsSync(ocConfigPath)) {
    const config = readJson(ocConfigPath)
    if (config.agent && Object.keys(config.agent).some((name) => VIBE_AGENTS.includes(name))) return true
  }
  if (existsSync(join(dir, ".vibeOS-locks"))) return true
  const envPath = join(dir, ".env.production")
  if (existsSync(envPath)) {
    try {
      if (readFileSync(envPath, "utf8").includes("VIBEOS_API")) return true
    } catch {}
  }
  return false
}

function removeStrayDeployArtifact() {
  const dir = join(process.cwd(), "undefined")
  if (existsSync(dir) && looksLikeVibeArtifact(dir)) {
    try { rmSync(dir, { recursive: true, force: true }) } catch {}
    return true
  }
  return false
}

// Legacy installs used VIBEOS_OPENCODE_HOME=~ so the plugin deployed to
// ~/opencode.json + ~/plugins/vibeOS.js instead of ~/.opencode. Clean that too.
// ── Uninstall marker ──────────────────────────────────────────────
// A running OpenCode instance that loaded vibeOS before removal keeps the plugin
// in memory and re-registers tier agents into opencode.json on later turns. The
// marker (outside VIBEOS_HOME, which this script deletes) tells any loaded
// instance to stop. Reinstall (setup) removes the marker.
const UNINSTALL_MARKER = "vibeOS-uninstalled"

function writeUninstallMarker() {
  const targets = [
    join(HOME, ".opencode", UNINSTALL_MARKER),
    join(HOME, ".config", "opencode", UNINSTALL_MARKER),
  ]
  for (const t of targets) {
    try {
      mkdirSync(dirname(t), { recursive: true })
      writeFileSync(t, "vibeOS uninstalled — do not register tier agents or write configs.\n")
    } catch {}
  }
  return targets
}

function detectRunningOpenCode() {
  try {
    const out = execSync("ps ax -o pid=,command= 2>/dev/null | grep -i opencode | grep -v grep || true", { encoding: "utf8" })
    return out.split("\n").filter((l) => l.trim()).slice(0, 8)
  } catch {
    return []
  }
}

function removeHomeRootDeployment() {  let did = false
  if (stripVibeFromConfig(join(HOME, "opencode.json"))) did = true
  const pluginDir = join(HOME, "plugins")
  for (const rel of ["vibeOS.js", "vibeOS.js.deploying", "vibeOS.js.tmp", "assets", ".env.production", "tests"]) {
    const t = join(pluginDir, rel)
    if (existsSync(t)) {
      try { rmSync(t, { recursive: true, force: true }) } catch {}
      did = true
    }
  }
  try {
    if (existsSync(pluginDir) && readdirSync(pluginDir).length === 0) rmSync(pluginDir, { recursive: true, force: true })
  } catch {}
  for (const name of readdirSync(HOME)) {
    if (name.startsWith("config.json.vibeos-bak-")) {
      try { rmSync(join(HOME, name), { force: true }) } catch {}
      did = true
    }
  }
  for (const p of [join(HOME, "data", "vibemax-model.json"), join(HOME, ".config", "data", "vibemax-model.json")]) {
    if (existsSync(p)) {
      try { rmSync(p, { force: true }) } catch {}
      did = true
    }
  }
  const dbBackup = join(HOME, ".local", "share", "opencode", "opencode.db.vibeos-backup")
  if (existsSync(dbBackup)) {
    try { rmSync(dbBackup, { force: true }) } catch {}
    did = true
  }
  return did
}

writeLine()
writeLine("vibeOS — clean uninstall")
writeLine()

let didSomething = false
for (const home of resolveOpenCodeHomes({ cwd: process.cwd() })) {
  if (unregisterFromOpenCodeConfig(home)) {
    writeLine(`✓ unregistered vibeOS from ${home}/opencode.json`)
    didSomething = true
  }
  removePluginFiles(home)
  removeSkills(home)
  pruneEmptyDirs(home)
  writeLine(`✓ removed plugin files + /vibe skill from ${home}/`)
  didSomething = true
}

const stripped = []
for (const home of resolveOpenCodeHomes({ cwd: process.cwd() })) {
  for (const p of [home, join(HOME, ".config", "opencode"), join(HOME, "Library", "Application Support", "ai.opencode.desktop")]) {
    const path = join(p, "opencode.json")
    if (stripVibeFromConfig(path)) stripped.push(path)
  }
}
for (const p of [join(process.cwd(), "opencode.json"), join(process.cwd(), ".opencode", "opencode.json")]) {
  if (stripVibeFromConfig(p)) stripped.push(p)
}
for (const path of [...new Set(stripped)]) {
  writeLine(`✓ stripped vibe agents/config from ${path}`)
  didSomething = true
}

const stateRemoved = removeStateDirs()
if (stateRemoved > 0) {
  writeLine(`✓ removed ${stateRemoved} VIBEOS_HOME runtime state dir(s)`)
  didSomething = true
}
const claudeRemoved = removeClaudeVibeFiles()
if (claudeRemoved > 0) {
  writeLine(`✓ removed ${claudeRemoved} vibe file(s) from ~/.claude`)
  didSomething = true
}
const debugRemoved = removeDebugArtifacts()
if (debugRemoved > 0) {
  writeLine(`✓ removed ${debugRemoved} vibe debug artifact dir(s)`)
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
if (unlinkGlobalPackage()) {
  writeLine("✓ unlinked global npm package")
  didSomething = true
}
if (removeStrayDeployArtifact()) {
  writeLine("✓ removed stray undefined/ deploy artifact")
  didSomething = true
}
if (removeHomeRootDeployment()) {
  writeLine("✓ removed legacy home-root deployment (~/opencode.json + ~/plugins)")
  didSomething = true
}

writeUninstallMarker()
writeLine("✓ wrote uninstall marker — loaded vibeOS instances will stop re-registering configs")
didSomething = true

const running = detectRunningOpenCode()
if (running.length > 0) {
  writeLine()
  writeLine("⚠ OpenCode is still running with vibeOS loaded in memory:")
  for (const line of running) writeLine("    " + line.trim().slice(0, 100))
  writeLine()
  writeLine("  Fully quit OpenCode (macOS: Cmd+Q, or from the app menu) to unload the plugin.")
  writeLine("  The uninstall marker takes effect the moment the app is restarted;")
  writeLine("  it is not required to remove anything else, but the running app can")
  writeLine("  otherwise keep re-writing configs until you quit it.")
}

writeLine()
if (didSomething) {
  writeLine("vibeOS uninstall complete. Restart OpenCode to apply.")
  writeLine("Reinstall anytime with: npx vibeostheog setup")
} else {
  writeLine("Nothing to do — vibeOS was already uninstalled.")
}

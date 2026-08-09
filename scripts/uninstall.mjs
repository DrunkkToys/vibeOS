#!/usr/bin/env node
// vibeOS uninstall — mirrors scripts/deploy.mjs in reverse.
// Sweeps EVERY OpenCode home an install could have targeted (~/.opencode, the
// XDG dir, the desktop app support dir, the project-level .opencode, plus any
// VIBEOS_OPENCODE_HOME override) and removes: the plugin entry and vibe tier
// agents from opencode.json AND opencode.jsonc, default_agent, plugin files,
// the /vibe skill, home-root runtime artifacts (retention log, pattern store),
// vibeOS auto-generated project skills, the launch agent, the nightly cron, the
// global npm link, every known runtime state dir (VIBEOS_HOME, ~/.vibetheog,
// ~/.vibeos, desktop vibeOS, debug artifacts), the legacy home-root deployment,
// and stray deploy artifacts.
// Leaves ~/.claude, OpenCode's own config and ~/.opencode/bin/opencode intact so
// OpenCode itself keeps working and a reinstall starts from a blank slate.
// Set VIBEOS_UNINSTALL_SKIP_SYSTEM=1 to skip the machine-global side effects
// (crontab, launchctl bootout, npm unlink) — they ignore a redirected HOME.

import { execFileSync, execSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync, mkdirSync } from "node:fs"
import { join, dirname, basename, resolve } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import { resolveOpenCodeHomes } from "./lib/opencode-homes.mjs"

const SELF_PATH = fileURLToPath(import.meta.url)
const __dirname = dirname(SELF_PATH)
const ROOT = join(__dirname, "..")
const HOME = homedir()

const VIBE_AGENTS = ["vibe", "vibe-cheap", "vibe-medium", "vibe-brain"]
const VIBE_DEFAULT_AGENT_RE = /^vibe$|^vibe-(cheap|medium|brain)$/
const LAUNCH_AGENT_LABEL = "com.vibeos.opencode-event-retention"
const CRON_MARKER = "# vibeOS nightly pricing sync"
const OC_CONFIG_NAMES = ["opencode.json", "opencode.jsonc"]

// Machine-wide side effects (crontab, launchctl, npm link) are global: they
// ignore a redirected HOME. Tests set this to keep an isolated run isolated.
const SKIP_SYSTEM = process.env.VIBEOS_UNINSTALL_SKIP_SYSTEM === "1"

function safeReaddir(dir) {
  try {
    return existsSync(dir) ? readdirSync(dir) : []
  } catch {
    return []
  }
}

function rmQuiet(target) {
  if (!existsSync(target)) return false
  try {
    rmSync(target, { recursive: true, force: true })
  } catch {
    return false
  }
  return true
}

// Every directory an install (current, legacy, XDG, desktop, or project-level)
// could have deployed into. The uninstaller must sweep all of them, not just
// the one the current deploy would pick.
function uninstallHomes(cwd = process.cwd()) {
  const homes = new Set(resolveOpenCodeHomes({ cwd }))
  const xdgConfig = process.env.XDG_CONFIG_HOME?.trim() || join(HOME, ".config")
  for (const h of [
    join(HOME, ".opencode"),
    join(xdgConfig, "opencode"),
    join(HOME, "Library", "Application Support", "ai.opencode.desktop"),
    join(cwd, ".opencode"),
  ]) {
    homes.add(h)
  }
  return [...homes]
}

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
  let changed = false
  for (const name of OC_CONFIG_NAMES) {
    if (unregisterFromConfigFile(join(home, name))) changed = true
  }
  return changed
}

function unregisterFromConfigFile(ocConfigPath) {
  if (!existsSync(ocConfigPath)) return false
  let config = readJson(ocConfigPath)
  let changed = false
  if (Array.isArray(config.plugin)) {
    const before = config.plugin.length
    config.plugin = config.plugin.filter((entry) => {
      const p = typeof entry === "string" ? entry : String(entry?.path || entry?.ref || "")
      return !p || !p.includes("vibeOS")
    })
    const after = config.plugin.length
    if (after === 0) delete config.plugin
    if (after !== before) changed = true
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

// Known VIBEOS_HOME locations. Never touches ~/.claude (Claude Code's home).
function collectStateRoots() {
  const roots = new Set()
  const explicit = process.env.VIBEOS_HOME?.trim()
  if (explicit && explicit !== join(HOME, ".vibeos")) roots.add(explicit)
  for (const p of [
    join(HOME, ".vibeos"),
    join(HOME, ".vibetheog"),
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
  for (const name of safeReaddir(HOME)) {
    if (name.startsWith(".vibelm-debug") || name.startsWith(".vibeos-")) {
      if (rmQuiet(join(HOME, name))) removed++
    }
  }
  return removed
}

// vibeOS owns ~/.vibeos (decoupled from Claude Code). Clean ONLY that
// directory — never touch ~/.claude, which is Claude Code's home.
function removeVibeosHomeFiles() {
  const vibeosHome = join(HOME, ".vibeos")
  if (existsSync(vibeosHome)) {
    try { rmSync(vibeosHome, { recursive: true, force: true }) } catch {}
    return 1
  }
  return 0
}

function removePluginFiles(home) {
  const pluginDir = join(home, "plugins")
  let removed = false
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
    if (rmQuiet(t)) removed = true
  }
  // The deployed copy of THIS script. Node has already read it into memory, so
  // deleting it mid-run is safe on POSIX; skip the copy we are executing from
  // on platforms where it is not.
  const deployedSelf = join(pluginDir, "uninstall.mjs")
  if (existsSync(deployedSelf) && (process.platform !== "win32" || resolve(deployedSelf) !== resolve(SELF_PATH))) {
    if (rmQuiet(deployedSelf)) removed = true
  }
  return removed
}

// Files vibeOS writes at the OpenCode home ROOT (not under plugins/):
// the launch agent's stdout/stderr sink from deploy.mjs, and the pattern
// store from src/lib/pattern-store.ts. Never touches OpenCode's own files.
function removeRuntimeArtifacts(home) {
  let removed = false
  for (const name of [
    "opencode-retention.log",
    "learned-patterns.json",
    "recent-events.jsonl",
  ]) {
    if (rmQuiet(join(home, name))) removed = true
  }
  return removed
}

// Project skills generated by ensureProjectSkill() carry an explicit
// "Auto-generated by vibeOS" marker. Hand-written skills are left alone.
function removeGeneratedProjectSkills(dir) {
  let removed = false
  for (const skillsDir of [join(dir, ".opencode", "skills"), join(dir, "skills")]) {
    for (const entry of safeReaddir(skillsDir)) {
      const skillPath = join(skillsDir, entry, "SKILL.md")
      if (!existsSync(skillPath)) continue
      let body = ""
      try { body = readFileSync(skillPath, "utf8") } catch { continue }
      if (!body.includes("Auto-generated by vibeOS")) continue
      if (rmQuiet(join(skillsDir, entry))) removed = true
    }
  }
  return removed
}

function removeSkills(home) {
  let removed = false
  for (const t of [join(home, "skills", "vibe"), join(home, ".opencode", "skills", "vibe")]) {
    if (rmQuiet(t)) removed = true
  }
  return removed
}

function pruneEmptyDirs(home) {
  for (const rel of ["plugins", "skills", join(".opencode", "skills"), ".opencode"]) {
    const dir = join(home, rel)
    if (!existsSync(dir)) continue
    if (safeReaddir(dir).length === 0) rmQuiet(dir)
  }
}

function unloadLaunchAgent() {
  const plistPath = join(HOME, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`)
  if (!existsSync(plistPath)) return false
  if (SKIP_SYSTEM) return rmQuiet(plistPath)
  try {
    const domain = `gui/${process.getuid?.() || 0}`
    try { execFileSync("launchctl", ["bootout", domain, plistPath], { stdio: "ignore" }) } catch {}
  } catch {}
  try { rmSync(plistPath, { force: true }) } catch {}
  return true
}

function removeCron() {
  if (SKIP_SYSTEM) return false
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
  if (SKIP_SYSTEM) return false
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

function removeHomeRootDeployment() {
  let did = false
  if (stripVibeFromConfig(join(HOME, "opencode.json"))) did = true
  const pluginDir = join(HOME, "plugins")
  for (const rel of ["vibeOS.js", "vibeOS.js.deploying", "vibeOS.js.tmp", "assets", ".env.production", "tests"]) {
    if (rmQuiet(join(pluginDir, rel))) did = true
  }
  if (existsSync(pluginDir) && safeReaddir(pluginDir).length === 0) rmQuiet(pluginDir)
  for (const name of safeReaddir(HOME)) {
    if (name.startsWith("config.json.vibeos-bak-")) {
      if (rmQuiet(join(HOME, name))) did = true
    }
  }
  for (const p of [join(HOME, "data", "vibemax-model.json"), join(HOME, ".config", "data", "vibemax-model.json")]) {
    if (rmQuiet(p)) did = true
  }
  if (rmQuiet(join(HOME, ".local", "share", "opencode", "opencode.db.vibeos-backup"))) did = true
  return did
}

writeLine()
writeLine("vibeOS — clean uninstall")
writeLine()

let didSomething = false
const HOMES = uninstallHomes()

if (removeGeneratedProjectSkills(process.cwd())) {
  writeLine("✓ removed vibeOS auto-generated project skill(s) from this project")
  didSomething = true
}

for (const home of HOMES) {
  if (unregisterFromOpenCodeConfig(home)) {
    writeLine(`✓ unregistered vibeOS from ${home}/opencode.json`)
    didSomething = true
  }
  const cleaned = [
    removePluginFiles(home),
    removeSkills(home),
    removeRuntimeArtifacts(home),
  ].some(Boolean)
  pruneEmptyDirs(home)
  if (cleaned) {
    writeLine(`✓ removed plugin files, /vibe skill and runtime artifacts from ${home}/`)
    didSomething = true
  }
}

const stripped = []
for (const p of [process.cwd(), join(process.cwd(), ".opencode")]) {
  for (const name of OC_CONFIG_NAMES) {
    const path = join(p, name)
    if (unregisterFromConfigFile(path)) stripped.push(path)
  }
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
const vibeosHomeRemoved = removeVibeosHomeFiles()
if (vibeosHomeRemoved > 0) {
  writeLine("✓ removed vibeOS home (~/.vibeos)")
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
  const appPids = running
    .map((l) => {
      const pid = l.trim().split(/\s+/)[0]
      return /OpenCode\.app\/Contents\/MacOS\/OpenCode$/.test(l.trim().split(/\s+/).slice(1).join(" ")) ? pid : null
    })
    .filter((pid) => /^\d+$/.test(pid))
  const quitFlag = process.argv.includes("--quit-app") || process.env.VIBEOS_UNINSTALL_QUIT === "1"
  if (quitFlag) {
    writeLine()
    writeLine("⚠ terminating running OpenCode to unload the in-memory plugin…")
    for (const pid of appPids) {
      try {
        execSync(`kill ${pid} 2>/dev/null || true`)
        writeLine(`    killed pid ${pid}`)
      } catch {}
    }
    try {
      execSync("osascript -e 'quit app \"OpenCode\"' 2>/dev/null || true")
    } catch {}
    writeLine("  OpenCode terminated. Relaunch it — vibeOS will not load (plugin removed + marker set).")
  } else {
    writeLine()
    writeLine("⚠ OpenCode is still running with vibeOS loaded in memory:")
    for (const line of running) writeLine("    " + line.trim().slice(0, 100))
    writeLine()
    writeLine("  Re-run with --quit-app to terminate it now, or fully quit OpenCode yourself")
    writeLine("  (macOS: Cmd+Q / app menu). The marker takes effect the moment it restarts.")
  }
}

writeLine()
if (didSomething) {
  writeLine("vibeOS uninstall complete. Restart OpenCode to apply.")
  writeLine("Reinstall anytime with: npx vibeostheog setup")
} else {
  writeLine("Nothing to do — vibeOS was already uninstalled.")
}

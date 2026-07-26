#!/usr/bin/env node

import { cpSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync, renameSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"
import { resolveOpenCodeHomes } from "./lib/opencode-homes.mjs"
import { installVibeSkill } from "./lib/vibe-skill.mjs"
import { installVibeTierAgentsInConfig } from "./lib/vibe-tier-agents.mjs"
import { normalizeVibeOSPluginRefs, resolveVibeOSPluginRef } from "./lib/plugin-config.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")

const bundlePath = join(ROOT, "dist", "vibeOS.js")
const assetsPath = join(ROOT, "dist", "assets")
const retentionScriptPath = join(ROOT, "scripts", "opencode-event-retention.mjs")

function xml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

async function installRetentionAgent(pluginDir) {
  if (process.platform !== "darwin" || !existsSync(retentionScriptPath)) return
  const runtimePath = join(pluginDir, "opencode-event-retention.mjs")
  copyFileSync(retentionScriptPath, runtimePath)
  const label = "com.vibeos.opencode-event-retention"
  const plistPath = join(homedir(), "Library", "LaunchAgents", `${label}.plist`)
  mkdirSync(dirname(plistPath), { recursive: true })
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(runtimePath)}</string></array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>3600</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(join(homedir(), ".opencode", "opencode-retention.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(homedir(), ".opencode", "opencode-retention.log"))}</string>
</dict></plist>\n`
  writeFileSync(plistPath, plist)
  try {
    const { execFileSync } = await import("node:child_process")
    const domain = `gui/${process.getuid?.() || 0}`
    try { execFileSync("launchctl", ["bootout", domain, plistPath], { stdio: "ignore" }) } catch {}
    execFileSync("launchctl", ["bootstrap", domain, plistPath], { stdio: "ignore" })
  } catch {}
  process.stderr.write(`[vibeOS deploy] Installed guarded OpenCode event-retention job at ${plistPath}\n`)
}

if (!existsSync(bundlePath)) {
  process.stderr.write("[vibeOS deploy] ERROR: dist/vibeOS.js not found\n")
  process.exit(1)
}

try {
  const bundle = readFileSync(bundlePath)
  for (const home of resolveOpenCodeHomes()) {
    const pluginDir = join(home, "plugins")
    const destPath = join(pluginDir, "vibeOS.js")
    const destAssets = join(pluginDir, "assets")

    if (!existsSync(pluginDir)) {
      mkdirSync(pluginDir, { recursive: true })
    }
    const tmpDest = destPath + '.deploying'
    writeFileSync(tmpDest, bundle)
    renameSync(tmpDest, destPath)
    process.stderr.write(`[vibeOS deploy] dist/vibeOS.js -> ${home}/plugins/vibeOS.js (${bundle.length} bytes) [atomic]\n`)
    await installRetentionAgent(pluginDir)

    if (existsSync(assetsPath)) {
      const tmpAssets = destAssets + '.deploying'
      if (existsSync(tmpAssets)) rmSync(tmpAssets, { recursive: true, force: true })
      cpSync(assetsPath, tmpAssets, { recursive: true, force: true })
      if (existsSync(destAssets)) rmSync(destAssets, { recursive: true, force: true })
      renameSync(tmpAssets, destAssets)
      process.stderr.write(`[vibeOS deploy] dist/assets/ -> ${home}/plugins/assets/ [atomic]\n`)
    }
    const skill = installVibeSkill(home)
    if (skill.created) {
      process.stderr.write(`[vibeOS deploy] Installed /vibe skill at ${skill.path}\n`)
    }

    for (const staleDir of [join(pluginDir, "lib"), join(pluginDir, "utils"), join(pluginDir, "vibeOS-lib"), join(pluginDir, "vibeOS-api-server"), join(pluginDir, "dashboard", "dist")]) {
      if (existsSync(staleDir)) {
        rmSync(staleDir, { recursive: true, force: true })
      }
    }
    const rmTsRecursive = (d) => { for (const e of readdirSync(d)) { const f = join(d, e); if (statSync(f).isDirectory()) rmTsRecursive(f); else if (e.endsWith('.ts')) { rmSync(f); } } }
    rmTsRecursive(pluginDir)
    process.stderr.write(`[vibeOS deploy] Stripped .ts files from ${home}/plugins\n`)
  }

  const envSrc = join(ROOT, ".env.production")
  if (existsSync(envSrc)) {
    const envContent = readFileSync(envSrc)
    const vibeHomeDir = process.env.VIBEOS_HOME?.trim()

    if (vibeHomeDir) {
      mkdirSync(vibeHomeDir, { recursive: true })
      const vibeEnvPath = join(vibeHomeDir, ".env.production")
      if (!existsSync(vibeEnvPath)) {
        writeFileSync(vibeEnvPath, envContent)
      }
    }
    for (const home of resolveOpenCodeHomes()) {
      const pluginEnvDir = join(home, "plugins")
      mkdirSync(pluginEnvDir, { recursive: true })
      writeFileSync(join(pluginEnvDir, ".env.production"), envContent)
    }
    process.stderr.write(`[vibeOS deploy] Synced .env.production to plugin dirs${vibeHomeDir ? " and VIBEOS_HOME" : ""}\n`)
  }

  // ── Install nightly pricing sync cron if not already present ──
  const isWin = process.platform === "win32"
  if (!isWin) {
    try {
      const { execSync } = await import("node:child_process")
      const CRON_MARKER = "# vibeOS nightly pricing sync"
      const cronLogDir = process.env.VIBEOS_HOME?.trim() || join(homedir(), ".claude")
      const CRON_LINE = "0 0 * * * " + join(ROOT, "scripts", "nightly-experiment-cron.sh") + " >> " + join(cronLogDir, "pricing-sync-cron.log") + " 2>&1"
      let currentCrontab = ""
      try { currentCrontab = execSync("crontab -l 2>/dev/null || true", { encoding: "utf8" }) } catch (e) { /* no crontab yet */ }
      if (!currentCrontab.includes(CRON_MARKER)) {
        const newCrontab = (currentCrontab.trim() + "\n" + CRON_MARKER + "\n" + CRON_LINE + "\n").trimStart()
        execSync("crontab -", { input: newCrontab, encoding: "utf8" })
        process.stderr.write("[vibeOS deploy] Added nightly pricing sync cron (0 0 * * *)\n")
      }
    } catch (e) {
      process.stderr.write("[vibeOS deploy] WARNING: could not install nightly pricing cron.\n")
      if (process.platform === "darwin") {
        process.stderr.write("[vibeOS deploy]   macOS: grant Full Disk Access in System Settings > Privacy > Full Disk Access, then re-run deploy.\n")
      } else {
        const cronLogDir = process.env.VIBEOS_HOME?.trim() || join(homedir(), ".claude")
        process.stderr.write("[vibeOS deploy]   Linux: crontab -e and add '0 0 * * * " + join(ROOT, "scripts", "nightly-experiment-cron.sh") + " >> " + join(cronLogDir, "pricing-sync-cron.log") + " 2>&1'\n")
      }
      process.stderr.write("[vibeOS deploy]   24h pricing sync is recommended to keep model cost data current.\n")
    }
  } else {
    process.stderr.write("[vibeOS deploy] Windows: scheduled tasks not yet automated.\n")
    process.stderr.write("[vibeOS deploy]   Create a Task Scheduler task running daily: node " + join(ROOT, "scripts", "sync-pricing.mjs") + "\n")
    process.stderr.write("[vibeOS deploy]   Or install via WSL and use crontab there.\n")
  }

  // Auto-register in opencode.json so OpenCode loads the plugin
  try {
    for (const home of resolveOpenCodeHomes()) {
      const ocConfigPath = join(home, "opencode.json")
      const pluginRef = join(home, "plugins", "vibeOS.js")
      mkdirSync(dirname(ocConfigPath), { recursive: true })
      let config = {}
      if (existsSync(ocConfigPath)) {
        const raw = readFileSync(ocConfigPath, "utf-8")
        try {
          const cleaned = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")
          config = JSON.parse(cleaned)
        } catch {
          config = {}
        }
      }
      if (!config || typeof config !== "object" || Array.isArray(config)) config = {}
      if (!Array.isArray(config.plugin)) config.plugin = []
      config.$schema ||= "https://opencode.ai/config.json"
      config.plugin = normalizeVibeOSPluginRefs(config.plugin, pluginRef)
      installVibeTierAgentsInConfig(config)
      const ocConfigTmp = `${ocConfigPath}.tmp.${process.pid}.${Date.now()}`
      writeFileSync(ocConfigTmp, JSON.stringify(config, null, 2) + "\n")
      renameSync(ocConfigTmp, ocConfigPath)
      process.stderr.write(`[vibeOS deploy] Registered vibeOS in ${home}/opencode.json\n`)
    }
  } catch {
    process.stderr.write("[vibeOS deploy] Could not auto-register in opencode.json (plugin may need manual config)\n")
  }

  process.stderr.write("[vibeOS deploy] Done\n")
} catch (e) {
  process.stderr.write(`[vibeOS deploy] ERROR: ${e.message}\n`)
  process.exit(1)
}

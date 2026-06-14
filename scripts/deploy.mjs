#!/usr/bin/env node

import { cpSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")

const bundlePath = join(ROOT, "dist", "vibeOS.js")
const assetsPath = join(ROOT, "dist", "assets")

function resolveOpenCodeHomes() {
  const override = process.env.VIBEOS_OPENCODE_HOME
  if (override) return [override]
  const base = homedir()
  const desktopHome = process.env.VIBEOS_OPENCODE_DESKTOP_HOME
    || (process.platform === "darwin" ? join(base, "Library", "Application Support", "ai.opencode.desktop") : null)
  const configHome = join(base, ".config", "opencode")
  const dotHome = join(base, ".opencode")
  return [desktopHome, configHome, dotHome].filter(Boolean)
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
    writeFileSync(destPath, bundle)
    process.stderr.write(`[vibeOS deploy] dist/vibeOS.js -> ${home}/plugins/vibeOS.js (${bundle.length} bytes)\n`)

    if (existsSync(assetsPath)) {
      cpSync(assetsPath, destAssets, { recursive: true, force: true })
      process.stderr.write(`[vibeOS deploy] dist/assets/ -> ${home}/plugins/assets/\n`)
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
    const homeEnvDir = join(homedir(), ".claude")
    const homeEnvDest = join(homeEnvDir, ".env.production")

    mkdirSync(homeEnvDir, { recursive: true })
    writeFileSync(homeEnvDest, envContent)
    for (const home of resolveOpenCodeHomes()) {
      const pluginEnvDir = join(home, "plugins")
      mkdirSync(pluginEnvDir, { recursive: true })
      writeFileSync(join(pluginEnvDir, ".env.production"), envContent)
    }
    process.stderr.write(`[vibeOS deploy] Synced .env.production to plugin dirs and ~/.claude\n`)
  }

  // ── Install nightly pricing sync cron if not already present ──
  const isWin = process.platform === "win32"
  if (!isWin) {
    try {
      const { execSync } = await import("node:child_process")
      const CRON_MARKER = "# vibeOS nightly pricing sync"
      const CRON_LINE = "0 0 * * * " + join(ROOT, "scripts", "nightly-experiment-cron.sh") + " >> " + join(homedir(), ".claude", "pricing-sync-cron.log") + " 2>&1"
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
        process.stderr.write("[vibeOS deploy]   Linux: crontab -e and add '0 0 * * * " + join(ROOT, "scripts", "nightly-experiment-cron.sh") + " >> " + join(homedir(), ".claude", "pricing-sync-cron.log") + " 2>&1'\n")
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
      const filtered = config.plugin.filter((p) => !(typeof p === "string" && p.includes("vibeOS")))
      filtered.push(pluginRef)
      config.$schema ||= "https://opencode.ai/config.json"
      config.plugin = filtered
      writeFileSync(ocConfigPath, JSON.stringify(config, null, 2) + "\n")
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

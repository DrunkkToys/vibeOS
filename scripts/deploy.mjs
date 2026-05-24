#!/usr/bin/env node

import { cpSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")

const srcPath = join(ROOT, "src", "index.js")
const srcLibDir = join(ROOT, "src", "vibeOS-lib")
const pluginDir = join(homedir(), ".config", "opencode", "plugins")
const destPath = join(pluginDir, "vibeOS.js")
const destLibDir = join(pluginDir, "vibeOS-lib")

// vibeOS-api-server, vibeOS-mcp-server, and dashboard now live in vibeOScore package

if (!existsSync(srcPath)) {
  process.stderr.write("[vibeOS deploy] ERROR: src/index.js not found\n")
  process.exit(1)
}

try {
  if (!existsSync(pluginDir)) {
    mkdirSync(pluginDir, { recursive: true })
  }
  const src = readFileSync(srcPath)
  writeFileSync(destPath, src)
  process.stderr.write(`[vibeOS deploy] src/index.js -> ~/.config/opencode/plugins/vibeOS.js (${src.length} bytes)\n`)

  // Copy vibeOS-lib directory recursively (includes blackbox, utils, etc.)
  // Copy vibeOS-lib directory recursively (includes blackbox, utils, etc.)
  let libCount = 0
  if (existsSync(srcLibDir)) {
    cpSync(srcLibDir, destLibDir, { recursive: true, force: true })
    function countFiles(dir) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
          countFiles(full)
        } else {
          libCount++
        }
      }
    }
    if (existsSync(destLibDir)) countFiles(destLibDir)
    process.stderr.write(`[vibeOS deploy] src/vibeOS-lib/ -> ~/.config/opencode/plugins/vibeOS-lib/ (${libCount} files)\n`)
  }
  // Clean up legacy backend files if they exist
  const oldApiServerDir = join(pluginDir, "vibeOS-api-server")
  if (existsSync(oldApiServerDir)) {
    rmSync(oldApiServerDir, { recursive: true, force: true })
    process.stderr.write(`[vibeOS deploy] Removed legacy vibeOS-api-server dir\n`)
  }
  const oldMcpServer = join(pluginDir, "vibeOS-mcp-server.js")
  if (existsSync(oldMcpServer)) {
    rmSync(oldMcpServer)
    process.stderr.write(`[vibeOS deploy] Removed legacy vibeOS-mcp-server.js\n`)
  }
  const oldDashboardDist = join(pluginDir, "dashboard", "dist")
  if (existsSync(oldDashboardDist)) {
    rmSync(oldDashboardDist, { recursive: true, force: true })
    process.stderr.write(`[vibeOS deploy] Removed legacy dashboard dist dir\n`)
  }

  const rmTsRecursive = (d) => { for (const e of readdirSync(d)) { const f = join(d, e); if (statSync(f).isDirectory()) rmTsRecursive(f); else if (e.endsWith('.ts')) { rmSync(f); } } }
  rmTsRecursive(pluginDir)
  process.stderr.write(`[vibeOS deploy] Stripped .ts files from plugin dir\n`)

  const envSrc = join(ROOT, ".env.production")
  if (existsSync(envSrc)) {
    const envContent = readFileSync(envSrc)
    const pluginEnvDest = join(pluginDir, ".env.production")
    const homeEnvDir = join(homedir(), ".claude")
    const homeEnvDest = join(homeEnvDir, ".env.production")

    mkdirSync(homeEnvDir, { recursive: true })
    writeFileSync(pluginEnvDest, envContent)
    writeFileSync(homeEnvDest, envContent)
    process.stderr.write(`[vibeOS deploy] Synced .env.production to plugin dir and ~/.claude\n`)
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

  process.stderr.write("[vibeOS deploy] Done\n")
} catch (e) {
  process.stderr.write(`[vibeOS deploy] ERROR: ${e.message}\n`)
  process.exit(1)
}

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
  cpSync(srcLibDir, destLibDir, { recursive: true, force: true })
  let libCount = 0
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
    const envDest = join(pluginDir, ".env.production")
    if (!existsSync(envDest)) {
      writeFileSync(envDest, readFileSync(envSrc))
      process.stderr.write(`[vibeOS deploy] Copied .env.production to plugin dir\n`)
    }
  }

  process.stderr.write("[vibeOS deploy] Done\n")
} catch (e) {
  process.stderr.write(`[vibeOS deploy] ERROR: ${e.message}\n`)
  process.exit(1)
}

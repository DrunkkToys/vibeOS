#!/usr/bin/env node

import { cpSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")

const srcPath = join(ROOT, "src", "index.js")
const srcMcpServerPath = join(ROOT, "src", "vibeOS-mcp-server.js")
const srcLibDir = join(ROOT, "src", "vibeOS-lib")
const srcCommonLibDir = join(ROOT, "src", "lib")
const srcDashboardDistDir = join(ROOT, "src", "dashboard", "dist")
const pluginDir = join(homedir(), ".config", "opencode", "plugins")
const destPath = join(pluginDir, "vibeOS.js")
const destMcpServerPath = join(pluginDir, "vibeOS-mcp-server.js")
const destLibDir = join(pluginDir, "vibeOS-lib")
const destCommonLibDir = join(pluginDir, "lib")

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
  process.stderr.write(`[vibeOS deploy] src/index.js → ~/.config/opencode/plugins/vibeOS.js (${src.length} bytes)\n`)

  if (existsSync(srcMcpServerPath)) {
    writeFileSync(destMcpServerPath, readFileSync(srcMcpServerPath))
    process.stderr.write(`[vibeOS deploy] src/vibeOS-mcp-server.js → ~/.config/opencode/plugins/vibeOS-mcp-server.js\n`)
  }

  // Copy src/lib/ directory (state, pricing, hooks, etc.)
  if (existsSync(srcCommonLibDir)) {
    cpSync(srcCommonLibDir, destCommonLibDir, { recursive: true, force: true })
    let libCount = 0
    const walk = (d) => { for (const e of readdirSync(d)) { const f = join(d, e); if (statSync(f).isDirectory()) walk(f); else libCount++; } };
    if (existsSync(destCommonLibDir)) walk(destCommonLibDir)
    process.stderr.write(`[vibeOS deploy] src/lib/ → ~/.config/opencode/plugins/lib/ (${libCount} files)\n`)
  }

  if (existsSync(srcDashboardDistDir)) {
    const dest = join(pluginDir, "dashboard", "dist")
    cpSync(srcDashboardDistDir, dest, { recursive: true, force: true })
    process.stderr.write(`[vibeOS deploy] src/dashboard/dist/ → ~/.config/opencode/plugins/dashboard/dist/\n`)
  }

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
  process.stderr.write(`[vibeOS deploy] src/vibeOS-lib/ → ~/.config/opencode/plugins/vibeOS-lib/ (${libCount} files)\n`)

  // Copy vibeOS-api-server directory (remote API client, routes, middleware)
  const srcApiServerDir = join(ROOT, "src", "vibeOS-api-server")
  const destApiServerDir = join(pluginDir, "vibeOS-api-server")
  cpSync(srcApiServerDir, destApiServerDir, { recursive: true, force: true })
  let apiCount = 0
  function countApiFiles(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        countApiFiles(full)
      } else {
        apiCount++
      }
    }
  }
  if (existsSync(destApiServerDir)) countApiFiles(destApiServerDir)
  process.stderr.write(`[vibeOS deploy] src/vibeOS-api-server/ → ~/.config/opencode/plugins/vibeOS-api-server/ (${apiCount} files)\n`)

  const rmTsRecursive = (d) => { for (const e of readdirSync(d)) { const f = join(d, e); if (statSync(f).isDirectory()) rmTsRecursive(f); else if (e.endsWith('.ts')) { rmSync(f); } } };
  rmTsRecursive(pluginDir)
  process.stderr.write(`[vibeOS deploy] Stripped .ts files from plugin dir\n`)

  process.stderr.write("[vibeOS deploy] Done\n")
} catch (e) {
  process.stderr.write(`[vibeOS deploy] ERROR: ${e.message}\n`)
  process.exit(1)
}

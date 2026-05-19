#!/usr/bin/env node

import { cpSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")

const srcPath = join(ROOT, "src", "index.js")
const srcMcpServerPath = join(ROOT, "src", "vibeOS-mcp-server.js")
const srcLibDir = join(ROOT, "src", "vibeOS-lib")
const pluginDir = join(homedir(), ".config", "opencode", "plugins")
const destPath = join(pluginDir, "vibeOS.js")
const destMcpServerPath = join(pluginDir, "vibeOS-mcp-server.js")
const destLibDir = join(pluginDir, "vibeOS-lib")

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
  process.stderr.write("[vibeOS deploy] Done\n")
} catch (e) {
  process.stderr.write(`[vibeOS deploy] ERROR: ${e.message}\n`)
  process.exit(1)
}

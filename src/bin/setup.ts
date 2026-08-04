// SPDX-License-Identifier: MIT
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { resolveOpenCodeHome, resolveOpenCodeHomes } from "../../scripts/lib/opencode-homes.mjs"
import { installVibeTierAgentsInConfig } from "../../scripts/lib/vibe-tier-agents.mjs"
import { normalizeVibeOSPluginRefs, resolveVibeOSPluginRef } from "../../scripts/lib/plugin-config.mjs"
import { clearVibeOSUninstalledMarker } from "../lib/runtime-config.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")
const args = process.argv.slice(2)
const command = args.find(a => !a.startsWith("-")) ?? "setup"
const isInstallCommand = command === "setup" || command === "set"
const isUninstallCommand = command === "uninstall" || command === "un"
const isProject = args.includes("--project")
const writeLine = (text = "") => {
  process.stdout.write(text + "\n")
}

if (isUninstallCommand) {
  const uninstallScript = resolve(root, "scripts", "uninstall.mjs")
  if (!existsSync(uninstallScript)) {
    console.error("Fatal: scripts/uninstall.mjs not found at", uninstallScript)
    process.exit(1)
  }
  try {
    execFileSync(process.execPath, [uninstallScript], { stdio: "inherit", cwd: process.cwd() })
  } catch (err) {
    console.error("Uninstall failed:", err?.message || err)
    process.exit(1)
  }
  process.exit(0)
}

if (!isInstallCommand || args.includes("--help") || args.includes("-h")) {
  console.error("Usage: npx vibeostheog set [--project]            # install/update plugin")
  console.error("       npx vibeostheog setup [--project]        # alias of set")
  console.error("       npx vibeostheog uninstall                 # clean removal: plugin + state + launch agent + cron + configs")
  console.error("       npx vibeostheog un                       # alias of uninstall")
  process.exit(1)
}

// Reinstall clears the uninstall marker so tier agents are registered again.
clearVibeOSUninstalledMarker()

writeLine()
writeLine("vibeOS — cost-aware delegation enforcer for OpenCode")
writeLine()
writeLine("Installing to:")
for (const h of resolveOpenCodeHomes({ cwd: process.cwd() })) writeLine("  " + h)
writeLine()

const deployScript = resolve(root, "scripts", "deploy.mjs")
if (!existsSync(deployScript)) {
  console.error("Fatal: scripts/deploy.mjs not found at", deployScript)
  process.exit(1)
}
execFileSync(process.execPath, [deployScript], { stdio: "inherit", cwd: process.cwd() })

if (isProject) {
  const configPath = resolve(process.cwd(), "opencode.json")
  let config: Record<string, any> = {}
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf8"))
    } catch {
      config = {}
    }
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) config = {}
  if (!config.$schema) config.$schema = "https://opencode.ai/config.json"
  if (!Array.isArray(config.plugin)) config.plugin = []
  const installHome = resolveOpenCodeHome({ cwd: process.cwd() })
  const pluginRef = resolveVibeOSPluginRef(installHome)
  config.plugin = normalizeVibeOSPluginRefs(config.plugin, pluginRef)
  installVibeTierAgentsInConfig(config)
  mkdirSync(dirname(configPath), { recursive: true })
  const tmp = `${configPath}.tmp.${process.pid}.${Date.now()}`
  writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n")
  renameSync(tmp, configPath)
  writeLine(`vibeOS registered in ${configPath}`)
}

writeLine()
writeLine("Done. Restart OpenCode to activate the plugin.")

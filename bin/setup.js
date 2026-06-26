#!/usr/bin/env node

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveOpenCodeHome, resolveOpenCodeHomes } from "../scripts/lib/opencode-homes.mjs";
import { installVibeTierAgentsInConfig } from "../scripts/lib/vibe-tier-agents.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const args = process.argv.slice(2);
const command = args.find(a => !a.startsWith("-")) ?? "setup";
const isInstallCommand = command === "setup" || command === "set";
const isProject = args.includes("--project");
const isYes = args.includes("--yes") || args.includes("-y");

if (!isInstallCommand || args.includes("--help") || args.includes("-h")) {
  console.error("Usage: npx vibeostheog set [--project]");
  console.error("       npx vibeostheog setup [--project]");
  process.exit(1);
}

console.log("");
console.log("vibeOS — cost-aware delegation enforcer for OpenCode");
console.log("");
console.log("Installing to:");
for (const h of resolveOpenCodeHomes({ cwd: process.cwd() })) console.log("  " + h);
console.log("");

// Deploy plugin files to ~/.config/opencode/plugins/ and register globally
const deployScript = resolve(root, "scripts", "deploy.mjs");
if (!existsSync(deployScript)) {
  console.error("Fatal: scripts/deploy.mjs not found at", deployScript);
  process.exit(1);
}
execSync(`node "${deployScript}"`, { stdio: "inherit", cwd: process.cwd() });

// For per-project setup, also register in project-level opencode.json
if (isProject) {
  const configPath = resolve(process.cwd(), "opencode.json");
  let config = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf8"));
    } catch {
      config = {};
    }
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) config = {};
  if (!config.$schema) config.$schema = "https://opencode.ai/config.json";
  if (!Array.isArray(config.plugin)) config.plugin = [];
  const installHome = resolveOpenCodeHome({ cwd: process.cwd() });
  const pluginRef = resolve(installHome, "plugins", "vibeOS.js");
  config.plugin = config.plugin.filter((p) => !(typeof p === "string" && p.includes("vibeOS")));
  installVibeTierAgentsInConfig(config);
  if (!config.plugin.includes(pluginRef)) {
    config.plugin.push(pluginRef);
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  } else {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  }
  console.log(`vibeOS registered in ${configPath}`);
}

console.log("");
console.log("Done. Restart OpenCode to activate the plugin.");

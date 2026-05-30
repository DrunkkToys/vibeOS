#!/usr/bin/env node

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const args = process.argv.slice(2);
const isProject = args.includes("--project");

// Deploy plugin files to ~/.config/opencode/plugins/ and register globally
const deployScript = resolve(root, "scripts", "deploy.mjs");
if (!existsSync(deployScript)) {
  console.error("Fatal: scripts/deploy.mjs not found at", deployScript);
  process.exit(1);
}
execSync(`node "${deployScript}"`, { stdio: "inherit", cwd: root });

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
  const pluginRef = resolve(homedir(), ".config", "opencode", "plugins", "vibeOS.js");
  if (!config.plugin.includes(pluginRef)) {
    config.plugin.push(pluginRef);
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  }
  console.log(`vibeOS registered in ${configPath}`);
}

console.log("Done. Restart OpenCode to activate the plugin.");

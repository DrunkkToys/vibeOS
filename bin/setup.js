#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";

const pkgName = "vibeostheog";
const args = process.argv.slice(2);
const command = args[0] ?? "setup";
const isProject = args.includes("--project");

if (command !== "setup") {
  console.error(`Usage: ${pkgName} setup [--project]`);
  process.exit(1);
}

const configPath = isProject
  ? resolve(process.cwd(), "opencode.json")
  : resolve(homedir(), ".config", "opencode", "opencode.json");

let config = {};
try {
  config = JSON.parse(await readFile(configPath, "utf8"));
} catch {
  config = {};
}

if (!config || typeof config !== "object" || Array.isArray(config)) {
  config = {};
}

if (!config.$schema) {
  config.$schema = "https://opencode.ai/config.json";
}

if (!Array.isArray(config.plugin)) {
  config.plugin = [];
}

if (!config.plugin.includes(pkgName)) {
  config.plugin.push(pkgName);
}

await mkdir(dirname(configPath), { recursive: true });
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

console.log(`${pkgName} registered in ${configPath}`);
console.log("Restart OpenCode to activate the plugin.");

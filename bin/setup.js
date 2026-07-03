#!/usr/bin/env node

// src/bin/setup.ts
import { execFileSync } from "node:child_process";
import { readFileSync as readFileSync2, writeFileSync as writeFileSync2, existsSync as existsSync3, mkdirSync as mkdirSync2, renameSync as renameSync2 } from "node:fs";
import { dirname as dirname2, resolve as resolve2 } from "node:path";
import { fileURLToPath } from "node:url";

// scripts/lib/opencode-homes.mjs
import { join } from "node:path";
import { homedir } from "node:os";
function resolveOpenCodeHomes({ home = homedir() } = {}) {
  const override = process.env.VIBEOS_OPENCODE_HOME;
  if (override) return [override];
  return [join(home, ".opencode")];
}
function resolveOpenCodeHome(opts = {}) {
  return resolveOpenCodeHomes(opts)[0];
}

// scripts/lib/vibe-tier-agents.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join as join2 } from "node:path";
import { homedir as homedir2 } from "node:os";
var VIBE_TIER_AGENT_BY_SLOT = {
  cheap: "vibe-cheap",
  medium: "vibe-medium",
  brain: "vibe-brain"
};
var VIBE_PRIMARY_AGENT = "vibe";
function readJson(path) {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf8");
    const cleaned = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function readTiers(home = homedir2()) {
  return readJson(join2(process.env.VIBEOS_HOME || join2(home, ".claude"), "model-tiers.json"));
}
function primaryAgent(existing = {}) {
  const next = {
    ...existing && typeof existing === "object" ? existing : {},
    description: "VibeUltraX primary agent",
    mode: "primary",
    permission: {
      read: "allow",
      edit: "allow",
      glob: "allow",
      grep: "allow",
      list: "allow",
      bash: "allow",
      task: "allow",
      webfetch: "allow",
      websearch: "allow",
      ...existing?.permission && typeof existing.permission === "object" ? existing.permission : {}
    }
  };
  delete next.model;
  return next;
}
function tierAgent(slot, model, existing = {}) {
  return {
    ...existing && typeof existing === "object" ? existing : {},
    description: `VibeUltraX ${slot} tier subagent`,
    mode: "subagent",
    model,
    permission: {
      read: "allow",
      edit: "allow",
      glob: "allow",
      grep: "allow",
      list: "allow",
      bash: "allow",
      task: "allow",
      webfetch: "allow",
      websearch: "allow",
      ...existing?.permission && typeof existing.permission === "object" ? existing.permission : {}
    }
  };
}
function installVibeTierAgentsInConfig(config, tiers = readTiers()) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return false;
  const trinity = tiers?.trinity || {};
  config.$schema ||= "https://opencode.ai/config.json";
  config.agent = config.agent && typeof config.agent === "object" ? config.agent : {};
  let changed = false;
  const existingPrimary = config.agent[VIBE_PRIMARY_AGENT];
  const nextPrimary = primaryAgent(existingPrimary);
  if (JSON.stringify(existingPrimary || null) !== JSON.stringify(nextPrimary)) {
    config.agent[VIBE_PRIMARY_AGENT] = nextPrimary;
    changed = true;
  }
  if (config.default_agent !== VIBE_PRIMARY_AGENT) {
    config.default_agent = VIBE_PRIMARY_AGENT;
    changed = true;
  }
  for (const slot of ["cheap", "medium", "brain"]) {
    const model = String(trinity?.[slot]?.oc || "").trim();
    const name = VIBE_TIER_AGENT_BY_SLOT[slot];
    if (!model || !name) continue;
    const existing = config.agent[name];
    const next = tierAgent(slot, model, existing);
    if (JSON.stringify(existing || null) !== JSON.stringify(next)) {
      config.agent[name] = next;
      changed = true;
    }
  }
  return changed;
}

// scripts/lib/plugin-config.mjs
import { existsSync as existsSync2 } from "node:fs";
import { resolve } from "node:path";
function resolveVibeOSPluginRef(home) {
  return resolve(home, "plugins", "vibeOS.js");
}
function normalizeVibeOSPluginRefs(pluginList, canonicalPluginRef) {
  const refs = Array.isArray(pluginList) ? pluginList : [];
  const kept = [];
  let hasCanonical = false;
  for (const ref of refs) {
    if (typeof ref !== "string") {
      kept.push(ref);
      continue;
    }
    if (!ref.includes("vibeOS")) {
      kept.push(ref);
      continue;
    }
    const normalized = resolve(ref);
    if (normalized === canonicalPluginRef || ref === canonicalPluginRef) {
      if (!hasCanonical) {
        hasCanonical = true;
        kept.push(canonicalPluginRef);
      }
      continue;
    }
    if (existsSync2(normalized)) continue;
  }
  if (!hasCanonical) kept.push(canonicalPluginRef);
  return kept;
}

// src/bin/setup.ts
var __dirname = dirname2(fileURLToPath(import.meta.url));
var root = resolve2(__dirname, "..");
var args = process.argv.slice(2);
var command = args.find((a) => !a.startsWith("-")) ?? "setup";
var isInstallCommand = command === "setup" || command === "set";
var isProject = args.includes("--project");
var writeLine = (text = "") => {
  process.stdout.write(text + "\n");
};
if (!isInstallCommand || args.includes("--help") || args.includes("-h")) {
  console.error("Usage: npx vibeostheog set [--project]");
  console.error("       npx vibeostheog setup [--project]");
  process.exit(1);
}
writeLine();
writeLine("vibeOS \u2014 cost-aware delegation enforcer for OpenCode");
writeLine();
writeLine("Installing to:");
for (const h of resolveOpenCodeHomes({ cwd: process.cwd() })) writeLine("  " + h);
writeLine();
var deployScript = resolve2(root, "scripts", "deploy.mjs");
if (!existsSync3(deployScript)) {
  console.error("Fatal: scripts/deploy.mjs not found at", deployScript);
  process.exit(1);
}
execFileSync(process.execPath, [deployScript], { stdio: "inherit", cwd: process.cwd() });
if (isProject) {
  const configPath = resolve2(process.cwd(), "opencode.json");
  let config = {};
  if (existsSync3(configPath)) {
    try {
      config = JSON.parse(readFileSync2(configPath, "utf8"));
    } catch {
      config = {};
    }
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) config = {};
  if (!config.$schema) config.$schema = "https://opencode.ai/config.json";
  if (!Array.isArray(config.plugin)) config.plugin = [];
  const installHome = resolveOpenCodeHome({ cwd: process.cwd() });
  const pluginRef = resolveVibeOSPluginRef(installHome);
  config.plugin = normalizeVibeOSPluginRefs(config.plugin, pluginRef);
  installVibeTierAgentsInConfig(config);
  mkdirSync2(dirname2(configPath), { recursive: true });
  const tmp = `${configPath}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync2(tmp, JSON.stringify(config, null, 2) + "\n");
  renameSync2(tmp, configPath);
  writeLine(`vibeOS registered in ${configPath}`);
}
writeLine();
writeLine("Done. Restart OpenCode to activate the plugin.");

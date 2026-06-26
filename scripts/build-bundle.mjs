import { build } from 'esbuild';
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { resolveOpenCodeHomes } from './lib/opencode-homes.mjs';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');
const SRC_OUT = join(ROOT, 'src');
console.log('[bundle] Building single-file bundle...');

// Bundle the TS entrypoint into a single file
await build({
  entryPoints: [join(SRC, 'index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: join(DIST, 'vibeOS.js'),
  target: 'node22',
  external: ['node:*'],
  banner: { js: '#!/usr/bin/env node' },
  minify: false,
  sourcemap: false,
});

console.log('[bundle] Bundle created: dist/vibeOS.js');

// Copy non-JS assets (JSON configs, etc.)
const assetsDir = join(DIST, 'assets');
if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true });

// Copy flow-rules.json
const flowRulesSrc = join(SRC, 'flow-rules.json');
if (existsSync(flowRulesSrc)) {
  copyFileSync(flowRulesSrc, join(assetsDir, 'flow-rules.json'));
  console.log('[bundle] Copied flow-rules.json');
}

// Copy dashboard if exists
const dashboardSrc = join(SRC, 'lib', 'dashboard', 'dist');
if (existsSync(dashboardSrc)) {
  const dashboardDest = join(assetsDir, 'dashboard');
  if (!existsSync(dashboardDest)) mkdirSync(dashboardDest, { recursive: true });
  copyDirRecursive(dashboardSrc, dashboardDest);
  writeDashboardBaseConfig(
    dashboardDest,
    resolveDashboardBaseUrlFromState({
      publishedMcpBaseUrl: resolvePublishedMcpBaseUrl(),
      mcpPort: Number(process.env.VIBEOS_MCP_PORT || 63452),
    }),
  );
  console.log('[bundle] Copied dashboard');
}

for (const home of resolveOpenCodeHomes({ cwd: ROOT, home: homedir() })) {
  const pluginDir = join(home, 'plugins');
  const destPath = join(pluginDir, 'vibeOS.js');
  const pluginAssets = join(pluginDir, 'assets');
  if (!existsSync(pluginDir)) mkdirSync(pluginDir, { recursive: true });
  copyFileSync(join(DIST, 'vibeOS.js'), destPath);
  console.log(`[bundle] Deployed to ${destPath}`);
  if (!existsSync(pluginAssets)) mkdirSync(pluginAssets, { recursive: true });
  copyDirRecursive(assetsDir, pluginAssets);
  console.log(`[bundle] Deployed assets to ${pluginAssets}/`);
}

console.log('[bundle] Done!');

function copyDirRecursive(src, dest) {
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function resolvePublishedMcpBaseUrl() {
  const vibeHome = process.env.VIBEOS_HOME || join(homedir(), '.claude');
  const tiersPath = join(vibeHome, 'model-tiers.json');
  try {
    if (existsSync(tiersPath)) {
      const tiers = JSON.parse(readFileSync(tiersPath, 'utf8'));
      const port = Number(tiers?.selection?.mcp_port);
      if (Number.isFinite(port) && port > 0) {
        return `http://127.0.0.1:${port}`;
      }
    }
  } catch {}
  return '';
}

function writeDashboardBaseConfig(dir, baseUrl) {
  if (!baseUrl) return;
  const cfg = join(dir, 'vibeos-dashboard-config.js');
  writeFileSync(cfg, `window.__VIBEOS_DASHBOARD_BASE__ = ${JSON.stringify(baseUrl.replace(/\/$/, ''))};\n`, 'utf8');
}

function normalizeDashboardBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/$/, '');
}

function resolveDashboardBaseUrlFromState({
  dashboardBaseUrl = '',
  publishedMcpBaseUrl = '',
  fallbackPort = null,
  mcpPort = 0,
} = {}) {
  const fromMemory = normalizeDashboardBaseUrl(dashboardBaseUrl);
  if (fromMemory) return fromMemory;
  const fromPublished = normalizeDashboardBaseUrl(publishedMcpBaseUrl);
  if (fromPublished) return fromPublished;
  const port = Number(mcpPort);
  if (Number.isFinite(port) && port > 0) return `http://127.0.0.1:${port}`;
  const fallback = Number(fallbackPort);
  if (fallbackPort !== null && fallbackPort !== undefined && Number.isFinite(fallback) && fallback > 0) return `http://127.0.0.1:${fallback}`;
  return '';
}

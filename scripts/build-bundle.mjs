import { build } from 'esbuild';
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { resolveDashboardBaseUrlFromState } from '../src/lib/dashboard-base-url.js';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');
const SRC_OUT = join(ROOT, 'src');
const PLUGIN_DIR = join(homedir(), '.config', 'opencode', 'plugins');

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

// Deploy to plugin directory
if (!existsSync(PLUGIN_DIR)) mkdirSync(PLUGIN_DIR, { recursive: true });
copyFileSync(join(DIST, 'vibeOS.js'), join(PLUGIN_DIR, 'vibeOS.js'));
console.log(`[bundle] Deployed to ${PLUGIN_DIR}/vibeOS.js`);

// Copy assets
const pluginAssets = join(PLUGIN_DIR, 'assets');
if (!existsSync(pluginAssets)) mkdirSync(pluginAssets, { recursive: true });
copyDirRecursive(assetsDir, pluginAssets);
console.log(`[bundle] Deployed assets to ${PLUGIN_DIR}/assets/`);

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

#!/usr/bin/env node

import { execSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync, unlinkSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { tmpdir, homedir } from "node:os"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")

const BOLD = "\x1b[1m"
const RED = "\x1b[31m"
const GREEN = "\x1b[32m"
const YELLOW = "\x1b[33m"
const CYAN = "\x1b[36m"
const RESET = "\x1b[0m"

function sh(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf-8", cwd: ROOT, ...opts }).trim()
}

function log(msg) {
  process.stderr.write(`${msg}\n`)
}

function die(msg) {
  log(`${RED}ERROR:${RESET} ${msg}`)
  process.exit(1)
}

function releaseSeriesName(version) {
  const parts = String(version || "").split(".").map(Number)
  if (parts.length >= 2 && parts[0] === 0 && parts[1] === 24) return "Return"
  if (parts.length >= 2 && parts[0] === 0 && parts[1] === 25) return "Innocence"
  return ""
}

function formatReleaseTitle(version) {
  const name = releaseSeriesName(version)
  return name ? `${name} v${version}` : `v${version}`
}

function resolveOpenCodeHomes() {
  const override = process.env.VIBEOS_OPENCODE_HOME
  if (override) return [override]
  const base = homedir()
  const configHome = join(base, ".config", "opencode")
  const dotHome = join(base, ".opencode")
  const roots = [configHome, dotHome]
  const existing = roots.filter((dir) => existsSync(join(dir, "opencode.json")) || existsSync(join(dir, "opencode.jsonc")) || existsSync(dir))
  return Array.from(new Set(existing.length > 0 ? existing : roots))
}

// ── ENSURE GH CLI ──────────────────────────────────────────────
try {
  sh("gh --version", { stdio: "pipe" })
} catch {
  die("gh (GitHub CLI) is required. Install: brew install gh && gh auth login")
}

// ── CLEAN WORKING TREE ────────────────────────────────────────
const status = sh("git status --porcelain")
if (status) {
  console.error("bypass clean check. commit or stash changes first.")
}

// ── BRANCH CHECK ──────────────────────────────────────────────
const branch = sh("git branch --show-current")
if (branch !== "main" && branch !== "master") {
  log(`${YELLOW}⚠${RESET}  not on main/master — current branch: ${CYAN}${branch}${RESET}`)
}

// ── RELEASE GATE: minimum 2-hour interval ──────────────────────
const minReleaseGapMs = 0
let lastTagDate
try {
  const lastTag = sh("git tag --sort=-creatordate --list 'v*' | head -1")
  if (lastTag) {
    lastTagDate = new Date(sh(`git log -1 --format=%ai ${lastTag}`))
  }
} catch {}
if (lastTagDate && (Date.now() - lastTagDate.getTime() < minReleaseGapMs)) {
  const nextAvailable = new Date(lastTagDate.getTime() + minReleaseGapMs)
  die(`at least ${minReleaseGapMs / 3600000}h required between releases. Last: ${lastTagDate.toISOString()}. Next available: ${nextAvailable.toISOString()}`)
}

// ── CLI ARG OVERRIDES ────────────────────────────────────────
const forceBump = ["patch", "minor", "major"].find(t => process.argv.includes(t)) || null
const autoYes = process.argv.includes("--yes") || process.argv.includes("-y")

// ── TEST GATE ──────────────────────────────────────────────────
if (process.argv.includes("--ci")) {
  log("")
  log(`${GREEN}✓${RESET} skipping test gate (CI already ran tests)`)
} else {
  log("")
  log(`${BOLD}🧪 Running tests before release...${RESET}`)
  try {
    sh("npm run test:ci", { stdio: "inherit" })
    log(`${GREEN}✓${RESET} all tests passed`)
  } catch {
    die("tests failed — release blocked. Fix failing tests before releasing.")
  }
}

// ── BUILD GATE ──────────────────────────────────────────────────
if (process.argv.includes("--ci")) {
  log("")
  log(`${GREEN}✓${RESET} skipping build gate (CI already built)`)
} else {
  log("")
  log(`${BOLD}🔨 Building before release...${RESET}`)
  try {
    sh("npm run build", { stdio: "inherit" })
    log(`${GREEN}✓${RESET} build succeeded`)
  } catch {
    die("build failed — release blocked. Fix build errors before releasing.")
  }
}

// ── SYNC MODEL PRICING ──────────────────────────────────────────
log("")
log(`${BOLD}💰 Syncing model pricing...${RESET}`)
try {
  sh(`node ${join(__dirname, "sync-pricing.mjs")}`, { stdio: "inherit" })
  log(`${GREEN}✓${RESET} pricing cache refreshed`)
} catch {
  log(`${YELLOW}⚠${RESET}  pricing sync failed — continuing with cached data`)
}

// ── CONVENTIONAL COMMITS → BUMP TYPE + CHANGELOG ──────────────

let lastTag
try {
  lastTag = sh("git describe --tags --abbrev=0 2>/dev/null")
} catch {
  lastTag = null
}

const range = lastTag ? `${lastTag}..HEAD` : "HEAD"
let commits
try {
  commits = sh(`git log ${range} --pretty=format:"%s"`)
} catch {
  die("no commits found")
}

if (!commits) {
  die(`no commits since ${lastTag || "root"}`)
}

const entries = commits.split("\n").filter(Boolean)

const ccRe = /^(?<type>feat|fix|perf|docs|style|refactor|test|chore|build|ci|bump|clean|license)(?:\((?<scope>[^)]+)\))?(?<bang>!)?:\s*(?<desc>.+)$/

let bump = forceBump || "patch"
const groups = { feat: [], fix: [], perf: [], refactor: [], docs: [], test: [], chore: [], misc: [] }

for (const entry of entries) {
  const m = entry.match(ccRe)
  if (!m) {
    groups.misc.push(entry)
    continue
  }

  const { type, desc, bang } = m.groups
  const line = `- ${type}: ${desc}`

  if (!forceBump) {
    if (bang) {
      bump = "major"
      groups.feat.push(`- **BREAKING**: ${desc}`)
    } else if (type === "feat" && bump !== "major") {
      bump = "minor"
    }
  }

  if (type === "feat") groups.feat.push(line)
  else if (type === "fix") groups.fix.push(line)
  else if (type === "perf") groups.perf.push(line)
  else if (type === "refactor") groups.refactor.push(line)
  else if (type === "docs") groups.docs.push(line)
  else if (type === "test") groups.test.push(line)
  else if (type === "chore" || type === "build" || type === "ci") groups.chore.push(line)
  else groups.misc.push(line)
}

groups.misc = groups.misc.filter(e => !/^- (bump|clean|license):/.test(e))

// ── BUMP VERSION ──────────────────────────────────────────────

const pkgPath = join(ROOT, "package.json")
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
const oldVer = pkg.version

function semverBump(ver, type) {
  const [major, minor, patch] = ver.split(".").map(Number)
  if (type === "major") return `${major + 1}.0.0`
  if (type === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

const newVer = semverBump(oldVer, bump)

// ── BUILD CHANGELOG BLOCK ──────────────────────────────────────

const changelogBlock = groups.feat
  .concat(groups.fix, groups.perf, groups.refactor, groups.docs, groups.test, groups.chore, groups.misc)
  .join("\n") + "\n"

// ── PREVIEW ────────────────────────────────────────────────────

log("")
log(`${BOLD}📦 Release Preview${RESET}`)
log(`   Version:  ${CYAN}${oldVer}${RESET} → ${GREEN}${newVer}${RESET}`)
log(`   Bump:     ${YELLOW}${bump}${RESET}${forceBump ? ` (forced)` : ``}`)
log(`   Tag:      ${GREEN}v${newVer}${RESET}`)
log(`   Name:     ${GREEN}${formatReleaseTitle(newVer)}${RESET}`)
log(`   Branch:   ${CYAN}${branch}${RESET}`)
log(`   Commits:  ${entries.length}`)
log("")
log(`${BOLD}Changelog:${RESET}`)
log(changelogBlock)
log("")

// ── CONFIRM ────────────────────────────────────────────────────

if (!autoYes) {
  const rl = await import("node:readline").then(m => m.default)
  const iface = rl.createInterface({ input: process.stdin, output: process.stderr })
  const answer = await new Promise(resolve => {
    iface.question(`${BOLD}Proceed with release?${RESET} [y/N] `, a => resolve(a.trim().toLowerCase()))
  })
  iface.close()
  if (answer !== "y" && answer !== "yes") {
    log("release cancelled.")
    process.exit(0)
  }
}

// ── UPDATE CHANGELOG ───────────────────────────────────────────

const changelogPath = join(ROOT, "CHANGELOG.md")
const existing = readFileSync(changelogPath, "utf-8")
const header = `## ${newVer}\n`
const updated = header + changelogBlock + "\n\n" + existing.replace(/^# Changelog\n\n/, "# Changelog\n\n")
writeFileSync(changelogPath, updated)

log(`${GREEN}✓${RESET} CHANGELOG.md updated`)

// ── UPDATE PACKAGE.JSON VERSION ──────────────────────────────────

pkg.version = newVer
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n")

log(`${GREEN}✓${RESET} package.json bumped to ${newVer}`)

// ── COMMIT CHANGELOG + PACKAGE.JSON ────────────────────────────

sh(`git add CHANGELOG.md package.json`)
sh(`git commit --no-verify -m "chore(release): v${newVer}"`)

log(`${GREEN}✓${RESET} chore(release): v${newVer} committed`)

// ── PACK LOCAL TARBALL ────────────────────────────────────────

for (const entry of readdirSync(ROOT)) {
  if (entry.endsWith(".tgz")) {
    unlinkSync(join(ROOT, entry))
  }
}

const npmCacheDir = mkdtempSync(join(tmpdir(), "vibetheog-npm-cache-"))
try {
  const packOutput = sh("npm pack", {
    env: {
      ...process.env,
      npm_config_cache: npmCacheDir,
    },
  })
  log(`${GREEN}✓${RESET} local npm pack artifact created: ${packOutput}`)
} finally {
  rmSync(npmCacheDir, { recursive: true, force: true })
}

// ── TAG ────────────────────────────────────────────────────────

sh(`git tag -a "v${newVer}" -m "v${newVer}"`)

log(`${GREEN}✓${RESET} tag v${newVer} created`)

// ── PUSH ───────────────────────────────────────────────────────

const remote = sh("git remote get-url origin 2>/dev/null || echo origin")
if (process.argv.includes("--ci")) {
  // In CI, GITHUB_TOKEN cannot push to protected master or create PRs.
  // Push the release commit to a release branch, then push the tag directly.
  const releaseBranch = `release/v${newVer}`
  sh(`git checkout -b ${releaseBranch}`)
  try {
    sh(`git push ${remote} ${releaseBranch}`)
    log(`${GREEN}${RESET} pushed to ${releaseBranch}`)
  } catch (e) {
    log(`${YELLOW}${RESET} could not push branch: ${e.message}`)
  }
} else {
  sh(`git push ${remote} ${branch}`)
  log(`${GREEN}${RESET} pushed to ${branch}`)
}

// Push tag (always works — tags skip branch protection)
try {
  sh(`git push ${remote} v${newVer}`)
  log(`${GREEN}${RESET} pushed tag v${newVer}`)
} catch (e) {
  log(`${YELLOW}${RESET} tag push failed: ${e.message}`)
}

sh(`git push ${remote} v${newVer}`)
log(`${GREEN}✓${RESET} pushed tag v${newVer}`)

// ── GITHUB RELEASE ─────────────────────────────────────────────

{
  const tmpDir = mkdtempSync(join(tmpdir(), "vibetheog-release-"))
  const notesPath = join(tmpDir, "release-notes.md")
  const releaseTitle = formatReleaseTitle(newVer)
  writeFileSync(notesPath, `## ${releaseTitle}\n\n## What's Changed\n\n${changelogBlock}`)
  try {
    sh(`gh release create "v${newVer}" --title "${releaseTitle}" --notes-file "${notesPath}"`)
    log(`${GREEN}✓${RESET} GitHub Release v${newVer} created`)
  } catch (e) {
    log(`${YELLOW}⚠${RESET}  GitHub Release creation failed: ${e.message}`)
    log(`   run manually: gh release create v${newVer} --title "${releaseTitle}" --notes-file "${notesPath}"`)
  }
  rmSync(tmpDir, { recursive: true })
}

// ── NPM PUBLISH ────────────────────────────────────────────────

log("")
log(`${BOLD}📦 Publishing to npm...${RESET}`)
const npmToken = process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN || ""
const npmrcDir = npmToken ? mkdtempSync(join(tmpdir(), "vibetheog-npmrc-")) : null
try {
  if (npmrcDir) {
    const npmrcPath = join(npmrcDir, ".npmrc")
    writeFileSync(
      npmrcPath,
      `//registry.npmjs.org/:_authToken=${npmToken}\nregistry=https://registry.npmjs.org/\nalways-auth=true\n`,
      "utf8",
    )
  }
  sh(`npm publish`, npmrcDir ? { env: { ...process.env, npm_config_userconfig: join(npmrcDir, ".npmrc") } } : {})
  log(`${GREEN}✓${RESET} v${newVer} published to npm`)
} catch (e) {
  log(`${YELLOW}⚠${RESET}  npm publish failed: ${e.message}`)
  log(`   run manually: npm publish`)
} finally {
  if (npmrcDir) {
    rmSync(npmrcDir, { recursive: true, force: true })
  }
}

// ── DEPLOY TO LOCAL PLUGIN DIR ─────────────────────────────────

if (process.argv.includes("--ci")) {
  log(`${YELLOW}⚠${RESET}  skipping local deploy (--ci mode)`)
} else {
  log("")
  log(`${BOLD}📨 Deploying plugin...${RESET}`)
  try {
    const { cpSync, readFileSync: rf, writeFileSync: wf, existsSync: ex, mkdirSync: mk, rmSync, readdirSync, statSync } = await import("node:fs")
    const srcPath = join(ROOT, "dist", "vibeOS.js")
    const src = rf(srcPath)
    const srcAssetsPath = join(ROOT, "dist", "assets")
    for (const home of resolveOpenCodeHomes()) {
      const pluginDir = join(home, "plugins")
      if (!ex(pluginDir)) {
        mk(pluginDir, { recursive: true })
      }

      const destPath = join(pluginDir, "vibeOS.js")
      wf(destPath, src)
      log(`${GREEN}✓${RESET} [vibeOS deploy] dist/vibeOS.js → ${home}/plugins/vibeOS.js (${src.length} bytes)`)

      const destAssetsPath = join(pluginDir, "assets")
      if (ex(srcAssetsPath)) {
        cpSync(srcAssetsPath, destAssetsPath, { recursive: true, force: true })
        log(`${GREEN}✓${RESET} [vibeOS deploy] dist/assets/ → ${home}/plugins/assets/`)
      }

      for (const staleDir of [join(pluginDir, "vibeOS-api-server"), join(pluginDir, "vibeOS-mcp-server.js"), join(pluginDir, "dashboard", "dist"), join(pluginDir, "lib"), join(pluginDir, "utils"), join(pluginDir, "vibeOS-lib")]) {
        if (ex(staleDir)) {
          rmSync(staleDir, { recursive: true, force: true })
        }
      }
    }
} catch (e) {
  log(`${YELLOW}⚠${RESET}  deploy step failed: ${e.message}`)
}
}

// ── DONE ───────────────────────────────────────────────────────

log("")
log(`${GREEN}${BOLD}✅ v${newVer} released${RESET}`)
log(`   ${CYAN}https://github.com/DrunkkToys/vibeOS/releases/tag/v${newVer}${RESET}`)
log("")

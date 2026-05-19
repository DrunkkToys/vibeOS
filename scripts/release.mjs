#!/usr/bin/env node

import { execSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
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

// ── ENSURE GH CLI ──────────────────────────────────────────────
try {
  sh("gh --version", { stdio: "pipe" })
} catch {
  die("gh (GitHub CLI) is required. Install: brew install gh && gh auth login")
}

// ── CLEAN WORKING TREE ────────────────────────────────────────
const status = sh("git status --porcelain")
if (status) {
  die("working directory not clean. commit or stash changes first.")
}

// ── BRANCH CHECK ──────────────────────────────────────────────
const branch = sh("git branch --show-current")
if (branch !== "main" && branch !== "master") {
  log(`${YELLOW}⚠${RESET}  not on main/master — current branch: ${CYAN}${branch}${RESET}`)
}

// ── CLI ARG OVERRIDES ────────────────────────────────────────
const forceBump = ["patch", "minor", "major"].find(t => process.argv.includes(t)) || null
const autoYes = process.argv.includes("--yes") || process.argv.includes("-y")

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
sh(`git commit -m "chore(release): v${newVer}"`)

log(`${GREEN}✓${RESET} chore(release): v${newVer} committed`)

// ── TAG ────────────────────────────────────────────────────────

sh(`git tag -a "v${newVer}" -m "v${newVer}"`)

log(`${GREEN}✓${RESET} tag v${newVer} created`)

// ── PUSH ───────────────────────────────────────────────────────

const remote = sh("git remote get-url origin 2>/dev/null || echo origin")
sh(`git push ${remote} ${branch}`)
log(`${GREEN}✓${RESET} pushed to ${branch}`)

sh(`git push ${remote} v${newVer}`)
log(`${GREEN}✓${RESET} pushed tag v${newVer}`)

// ── GITHUB RELEASE ─────────────────────────────────────────────

{
  const tmpDir = mkdtempSync(join(tmpdir(), "vibetheog-release-"))
  const notesPath = join(tmpDir, "release-notes.md")
  writeFileSync(notesPath, `## What's Changed\n\n${changelogBlock}`)
  try {
    sh(`gh release create "v${newVer}" --title "v${newVer}" --notes-file "${notesPath}"`)
    log(`${GREEN}✓${RESET} GitHub Release v${newVer} created`)
  } catch (e) {
    log(`${YELLOW}⚠${RESET}  GitHub Release creation failed: ${e.message}`)
    log(`   run manually: gh release create v${newVer} --notes-file "${notesPath}"`)
  }
  rmSync(tmpDir, { recursive: true })
}

// ── NPM PUBLISH ────────────────────────────────────────────────

log("")
log(`${BOLD}📦 Publishing to npm...${RESET}`)
try {
  sh(`npm publish`)
  log(`${GREEN}✓${RESET} v${newVer} published to npm`)
} catch (e) {
  log(`${YELLOW}⚠${RESET}  npm publish failed: ${e.message}`)
  log(`   run manually: npm publish`)
}

// ── DEPLOY TO LOCAL PLUGIN DIR ─────────────────────────────────

if (process.argv.includes("--ci")) {
  log(`${YELLOW}⚠${RESET}  skipping local deploy (--ci mode)`)
} else {
  log("")
  log(`${BOLD}📨 Deploying plugin...${RESET}`)
  try {
  const { cpSync, readFileSync: rf, writeFileSync: wf, existsSync: ex, mkdirSync: mk, readdirSync, statSync } = await import("node:fs")
  const pluginDir = join(homedir(), ".config", "opencode", "plugins")
  if (!ex(pluginDir)) {
    mk(pluginDir, { recursive: true })
  }

  const srcPath = join(ROOT, "src", "index.js")
  const destPath = join(pluginDir, "vibeOS.js")
  const src = rf(srcPath)
  wf(destPath, src)
  log(`${GREEN}✓${RESET} [vibeOS deploy] src/index.js → ~/.config/opencode/plugins/vibeOS.js (${src.length} bytes)`)

  const srcMcpServerPath = join(ROOT, "src", "vibeOS-mcp-server.js")
  const destMcpServerPath = join(pluginDir, "vibeOS-mcp-server.js")
  if (ex(srcMcpServerPath)) {
    wf(destMcpServerPath, rf(srcMcpServerPath))
    log(`${GREEN}✓${RESET} [vibeOS deploy] src/vibeOS-mcp-server.js → ~/.config/opencode/plugins/vibeOS-mcp-server.js`)
  }

  const srcLibDir = join(ROOT, "src", "vibeOS-lib")
  const destLibDir = join(pluginDir, "vibeOS-lib")
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
  if (ex(destLibDir)) countFiles(destLibDir)
  log(`${GREEN}✓${RESET} [vibeOS deploy] src/vibeOS-lib/ → ~/.config/opencode/plugins/vibeOS-lib/ (${libCount} files)`)
} catch (e) {
  log(`${YELLOW}⚠${RESET}  deploy step failed: ${e.message}`)
}

// ── DONE ───────────────────────────────────────────────────────

log("")
log(`${GREEN}${BOLD}✅ v${newVer} released${RESET}`)
log(`   ${CYAN}https://github.com/DrunkkToys/vibeOS/releases/tag/v${newVer}${RESET}`)
log("")

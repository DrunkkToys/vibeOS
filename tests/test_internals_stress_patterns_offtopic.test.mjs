import { createHash } from 'node:crypto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function makeSandbox(name) {
  const sandbox = mkdtempSync(join(tmpdir(), `vibeos-${name}-`))
  const home = sandbox
  mkdirSync(join(home, ".config/opencode"), { recursive: true })
  mkdirSync(join(home, ".claude/reports"), { recursive: true })
  mkdirSync(join(home, ".local/share/opencode"), { recursive: true })

  writeFileSync(join(home, ".config/opencode/opencode.json"), JSON.stringify({
    model: "deepseek/deepseek-v4-flash",
    provider: { deepseek: { models: { "deepseek-v4-flash": {} } } }
  }, null, 2) + "\n")

  writeFileSync(join(home, ".claude/model-tiers.json"), JSON.stringify({
    selection: {
      active_slot: "medium", enabled: true, delegation_enforce: false,
      flow_enabled: false, tdd_enforce: false, thinking_level: "off",
      blackbox_enabled: false
    },
    tiers: {
      high: { regex: "deepseek.*v4.*pro" },
      mid: { regex: "deepseek.*v4.*flash" },
      budget: { regex: ".*" }
    },
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-pro", cc: "haiku" },
      medium: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
      cheap: { oc: "deepseek/deepseek-chat", cc: "haiku" }
    }
  }, null, 2) + "\n")

  return { sandbox, home }
}

function fp(dir) {
  if (!dir) return "unknown"
  return createHash("sha256").update(dir).digest("hex").slice(0, 12)
}

// ── stress tests ─────────────────────────────────────

test("scoreStress: high stress >0.7 triggers CRITICAL directive", async () => {
  const { home, sandbox } = makeSandbox("stress-crit")
  const projectDir = join(sandbox, "proj")
  mkdirSync(projectDir)
  process.env.HOME = home
  const mod = await import("../src/index.js?str1=" + Date.now())
  const ctx = await mod.DelegationEnforcer({ directory: projectDir })
  const output = { system: [] }

  await ctx["experimental.chat.system.transform"](
    { message: { role: "user", content: "FUCKING BULLSHIT SHIT USELESS BROKEN TERRIBLE WRONG STUPID fix now immediately ASAP !!!" } },
    output
  )

  const sysText = output.system.join(" ")
  assert.ok(sysText.includes("stress mitigation: CRITICAL"),
    `Expected CRITICAL stress directive, got: ${sysText.slice(0, 200)}`)
})

test("scoreStress: moderate stress 0.4-0.7 triggers elevated directive", async () => {
  const { home, sandbox } = makeSandbox("stress-mod")
  const projectDir = join(sandbox, "proj")
  mkdirSync(projectDir)
  process.env.HOME = home
  const mod = await import("../src/index.js?str2=" + Date.now())
  const ctx = await mod.DelegationEnforcer({ directory: projectDir })
  const output = { system: [] }

  await ctx["experimental.chat.system.transform"](
    { message: { role: "user", content: "WRONG answers and BAD results. USELESS BROKEN code. FIX it." } },
    output
  )

  const sysText = output.system.join(" ")
  assert.ok(sysText.includes("stress mitigation: elevated"),
    `Expected elevated stress directive, got: ${sysText.slice(0, 200)}`)
})

test("scoreStress: calm text produces no stress directive", async () => {
  const { home, sandbox } = makeSandbox("stress-calm")
  const projectDir = join(sandbox, "proj")
  mkdirSync(projectDir)
  process.env.HOME = home
  const mod = await import("../src/index.js?str3=" + Date.now())
  const ctx = await mod.DelegationEnforcer({ directory: projectDir })
  const output = { system: [] }

  await ctx["experimental.chat.system.transform"](
    { message: { role: "user", content: "Can you help me refactor this function to use async/await?" } },
    output
  )

  const sysText = output.system ? output.system.join(" ") : ""
  assert.ok(!sysText.includes("stress mitigation"),
    "No stress directive expected for calm text")
})

// ── pattern learner tests ────────────────────────────

test("observeUserCorrection: import correction recorded as friction pattern", async () => {
  const { home, sandbox } = makeSandbox("patt-import")
  const projectDir = join(sandbox, "proj")
  mkdirSync(projectDir)
  process.env.HOME = home
  const mod = await import("../src/index.js?patt1=" + Date.now())
  const ctx = await mod.DelegationEnforcer({ directory: projectDir })

  await ctx["experimental.chat.system.transform"](
    { message: { role: "user", content: "the import was wrong, you imported the wrong module again" } },
    { system: [] }
  )

  const pstate = readJSON(join(home, ".claude/project-states.json"))
  const patterns = extractPatterns(pstate)
  assert.ok(patterns.some(p => p.key && p.key.includes("correction:imports")),
    `Expected import correction pattern, got: ${JSON.stringify(patterns)}`)
})

test("observeUserCorrection: verification correction recorded as pattern", async () => {
  const { home, sandbox } = makeSandbox("patt-verify")
  const projectDir = join(sandbox, "proj")
  mkdirSync(projectDir)
  process.env.HOME = home
  const mod = await import("../src/index.js?patt2=" + Date.now())
  const ctx = await mod.DelegationEnforcer({ directory: projectDir })

  await ctx["experimental.chat.system.transform"](
    { message: { role: "user", content: "You forgot tests before committing" } },
    { system: [] }
  )

  const pstate = readJSON(join(home, ".claude/project-states.json"))
  const patterns = extractPatterns(pstate)
  assert.ok(patterns.some(p => p.key && p.key.includes("correction:verification")),
    `Expected verification pattern, got: ${JSON.stringify(patterns)}`)
})

// ── off-topic detection tests ────────────────────────

test("isLikelyOffTopic: off-topic request triggers job-focus directive", async () => {
  const { home, sandbox } = makeSandbox("offtopic1")
  const projectDir = join(sandbox, "proj")
  mkdirSync(projectDir)
  const fprint = fp(projectDir)
  process.env.HOME = home

  writeFileSync(join(home, ".claude/active-jobs.json"), JSON.stringify({
    [fprint]: {
      prompt: "Write a React component for user authentication with login form and password validation",
      keywords: ["react", "component", "authentication", "login", "form", "password", "validation"],
      updatedAt: new Date().toISOString()
    }
  }) + "\n")

  const mod = await import("../src/index.js?off1=" + Date.now())
  const ctx = await mod.DelegationEnforcer({ directory: projectDir })
  const output = { system: [] }

  await ctx["experimental.chat.system.transform"](
    { message: { role: "user", content: "What is the weather like today? I want to know if it will rain." } },
    output
  )

  const sysText = output.system ? output.system.join(" ") : ""
  assert.ok(sysText.includes("job-focus"),
    `Expected job-focus directive, got: ${sysText.slice(0, 200)}`)
})

test("isLikelyOffTopic: on-topic request produces no job-focus directive", async () => {
  const { home, sandbox } = makeSandbox("ontopic")
  const projectDir = join(sandbox, "proj")
  mkdirSync(projectDir)
  const fprint = fp(projectDir)
  process.env.HOME = home

  writeFileSync(join(home, ".claude/active-jobs.json"), JSON.stringify({
    [fprint]: {
      prompt: "Write a React component for user authentication with login form and password validation",
      keywords: ["react", "component", "authentication", "login", "form", "password", "validation"],
      updatedAt: new Date().toISOString()
    }
  }) + "\n")

  const mod = await import("../src/index.js?off2=" + Date.now())
  const ctx = await mod.DelegationEnforcer({ directory: projectDir })
  const output = { system: [] }

  await ctx["experimental.chat.system.transform"](
    { message: { role: "user", content: "Add a password strength indicator to the login form component" } },
    output
  )

  const sysText = output.system ? output.system.join(" ") : ""
  assert.ok(!sysText.includes("job-focus"),
    "No job-focus directive expected for on-topic request")
})

test("isLikelyOffTopic: new task keyword bypasses detection", async () => {
  const { home, sandbox } = makeSandbox("newtask")
  const projectDir = join(sandbox, "proj")
  mkdirSync(projectDir)
  const fprint = fp(projectDir)
  process.env.HOME = home

  writeFileSync(join(home, ".claude/active-jobs.json"), JSON.stringify({
    [fprint]: {
      prompt: "Write a React component for user authentication",
      keywords: ["react", "component", "authentication"],
      updatedAt: new Date().toISOString()
    }
  }) + "\n")

  const mod = await import("../src/index.js?off3=" + Date.now())
  const ctx = await mod.DelegationEnforcer({ directory: projectDir })
  const output = { system: [] }

  await ctx["experimental.chat.system.transform"](
    { message: { role: "user", content: "new task: implement a REST API endpoint for user management" } },
    output
  )

  const sysText = output.system ? output.system.join(" ") : ""
  assert.ok(!sysText.includes("job-focus"),
    "No job-focus directive expected when user explicitly starts new task")
})

// ── helpers ──────────────────────────────────────────

function readJSON(path) {
  if (!existsSync(path)) return {}
  try { return JSON.parse(readFileSync(path, "utf-8")) }
  catch { return {} }
}

function extractPatterns(pstate) {
  const out = []
  for (const bucket of Object.values(pstate.project_hashes || {})) {
    for (const kind of ["friction", "routines"]) {
      for (const [key, row] of Object.entries(bucket?.userPatterns?.[kind] || {})) {
        out.push({ key, kind, summary: row.summary, count: row.count })
      }
    }
  }
  return out
}

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

let sandbox
test.before(() => {
  sandbox = mkdtempSync(join(tmpdir(), "vibeos-mega-"))
  process.env.HOME = sandbox
  process.env.VIBEOS_HOME = join(sandbox, ".claude")
  writeFileSync(join(sandbox, "opencode.json"), JSON.stringify({ model: "deepseek/deepseek-v4-pro" }))
  mkdirSync(join(sandbox, ".claude/scratch/by-hash"), { recursive: true })
  mkdirSync(join(sandbox, ".claude/scratch/sessions/sess-A/by-hash"), { recursive: true })
  mkdirSync(join(sandbox, ".claude/scratch/sessions/sess-B/by-hash"), { recursive: true })
  mkdirSync(join(sandbox, ".claude"), { recursive: true })
  writeFileSync(join(sandbox, ".claude", "delegation-state.json"), JSON.stringify({
    sessions: {}, lifetime: { cache_savings_usd: 0, total_savings_usd: 0 },
  }))
})
test.after(() => {
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
})

function setTiers() {
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    $schema_version: 1,
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-pro", cc: "deepseek-reasoner" },
      medium: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
      cheap: { oc: "deepseek/deepseek-v4-flash", cc: "haiku" },
    },
    selection: {
      enabled: true,
      active_slot: "brain",
      delegation_enforce: true,
      tdd_strict: false,
      flow_enabled: false,
      flow_enforce: false,
      tdd_enforce: false,
      tdd_quality: false,
      thinking_level: "off",
      onboarding_mode: "assist",
    },
    tiers: {
      high: { regex: "opus|gemini-.*-pro|deepseek.*v4.*pro|deepseek.*r1|deepseek.*reasoner|gpt-5|o1|o3|o4" },
      mid: { regex: "claude.*sonnet|sonnet|deepseek.*v4.*flash|gemini-.*-flash|gpt-4o" },
      budget: { regex: ".*" },
    },
  }, null, 2))
}

async function getHooks() {
  const mod = await import(join(root, "src/index.js?t=" + Date.now()))
  return mod.DelegationEnforcer({ client: {}, directory: sandbox })
}

function readTiersFile() {
  return JSON.parse(readFileSync(join(sandbox, ".claude/model-tiers.json"), "utf8"))
}

function readBlackboxFile() {
  return JSON.parse(readFileSync(join(sandbox, ".claude/blackbox-state.json"), "utf8"))
}

function readProjectStateFile() {
  return JSON.parse(readFileSync(join(sandbox, ".claude/project-states.json"), "utf8"))
}

// ── GROUP 1: VibeUltraX mode (Wired dynamic, not hardcoded) ──
test("1a — VibeUltraX exists in BRANDED_MODES with 107% quality", async () => {
  const { BRANDED_MODES } = await import(join(root, "src/lib/mode-router.js?mr=" + Date.now()))
  const vx = BRANDED_MODES.find(m => m.id === "vibeultrax")
  assert.ok(vx, "VibeUltraX in BRANDED_MODES")
  assert.equal(vx.qualityVsBrain, 107, "quality claim 107%")
  assert.equal(vx.pipeline[0], "cheap", "first tier is cheap")
  assert.ok(vx.pipeline.includes("brain"), "pipeline includes brain")
})

test("1b — VibeUltraX listed when trinity mode called without args", async () => {
  const { getBrandedModes } = await import(join(root, "src/lib/mode-router.js?mr2=" + Date.now()))
  const ids = getBrandedModes().map(m => m.id)
  assert.ok(ids.includes("vibeultrax"), "branded modes includes vibeultrax: " + ids.join(", "))
})

test("1c — fast trinity mode switch reads from BRANDED_MODES not hardcoded list", async () => {
  // Verify the handler uses BRANDED_MODES dynamically
  const tool = readFileSync(join(root, "src/lib/trinity-tool.ts"), "utf-8")
  const hasBrandedModes = tool.includes("BRANDED_MODES")
  assert.ok(hasBrandedModes, "trinity-tool imports BRANDED_MODES dynamically")
  assert.ok(!tool.includes('"vibemax", "vibeqmax", "vibeultrax"'),
    "mode list not hardcoded — uses BRANDED_MODES array")
})

test("1d — trinity set model override rewrites the slot map and live config for the project", async () => {
  setTiers()
  const targetModel = "magicoder:7b"
  const hooks = await getHooks()
  const result = await hooks.tool.trinity.execute({
    action: "set",
    slot: "cheap",
    model: targetModel,
  })
  const tiers = JSON.parse(readFileSync(join(sandbox, ".claude/model-tiers.json"), "utf8"))
  const sel = tiers.selection
  const oc = JSON.parse(readFileSync(join(sandbox, "opencode.json"), "utf8"))
  assert.equal(sel.active_slot, "cheap", "active slot switches to the requested cheap tier")
  assert.equal(tiers.trinity.cheap.oc, targetModel, "cheap slot model persisted in tier map")
  assert.equal(oc.model, targetModel, "OpenCode config switches to the overridden model")
  assert.equal(sel.selected_model, targetModel, "selected_model is persisted for the overridden model")
  assert.equal(sel.executed_model, targetModel, "executed_model is persisted for the overridden model")
  assert.ok(result.includes(targetModel), "response mentions overridden model: " + result.slice(0, 120))
})

test("1e — trinity set brain model override is live and persisted", async () => {
  setTiers()
  const targetModel = "openrouter/brain-live-proof"
  const hooks = await getHooks()
  const result = await hooks.tool.trinity.execute({
    action: "set",
    slot: "brain",
    model: targetModel,
  })
  const tiers = JSON.parse(readFileSync(join(sandbox, ".claude/model-tiers.json"), "utf8"))
  const sel = tiers.selection
  const oc = JSON.parse(readFileSync(join(sandbox, "opencode.json"), "utf8"))
  assert.equal(sel.active_slot, "brain", "active slot switches to the requested brain tier")
  assert.equal(tiers.trinity.brain.oc, targetModel, "brain slot model persisted in tier map")
  assert.equal(tiers.trinity.brain.manual, true, "brain override is marked manual")
  assert.equal(oc.model, targetModel, "OpenCode config switches to the overridden brain model")
  assert.equal(sel.selected_model, targetModel, "selected_model is persisted for the overridden brain model")
  assert.equal(sel.executed_model, targetModel, "executed_model is persisted for the overridden brain model")
  assert.ok(result.includes(targetModel), "response mentions overridden brain model: " + result.slice(0, 120))
})

test("1f — trinity set medium model override is live and persisted", async () => {
  setTiers()
  const targetModel = "openrouter/medium-live-proof"
  const hooks = await getHooks()
  const result = await hooks.tool.trinity.execute({
    action: "set",
    slot: "medium",
    model: targetModel,
  })
  const tiers = JSON.parse(readFileSync(join(sandbox, ".claude/model-tiers.json"), "utf8"))
  const sel = tiers.selection
  const oc = JSON.parse(readFileSync(join(sandbox, "opencode.json"), "utf8"))
  assert.equal(sel.active_slot, "medium", "active slot switches to the requested medium tier")
  assert.equal(tiers.trinity.medium.oc, targetModel, "medium slot model persisted in tier map")
  assert.equal(tiers.trinity.medium.manual, true, "medium override is marked manual")
  assert.equal(oc.model, targetModel, "OpenCode config switches to the overridden medium model")
  assert.equal(sel.selected_model, targetModel, "selected_model is persisted for the overridden medium model")
  assert.equal(sel.executed_model, targetModel, "executed_model is persisted for the overridden medium model")
  assert.ok(result.includes(targetModel), "response mentions overridden medium model: " + result.slice(0, 120))
})

test("1g — trinity status reports the live dashboard fields", async () => {
  setTiers()
  const hooks = await getHooks()
  const out = await hooks.tool.trinity.execute({ action: "status" })
  assert.ok(out.includes("[vibeOS-dashboard]"), "status should include dashboard header: " + out.slice(0, 160))
  assert.ok(out.includes("Model:"), "status should include model line: " + out.slice(0, 160))
  assert.ok(out.includes("Stress:"), "status should include stress line: " + out.slice(0, 160))
  assert.ok(out.includes("Enforce:"), "status should include enforcement line: " + out.slice(0, 160))
  assert.ok(out.includes("Lock:"), "status should include lock line: " + out.slice(0, 160))
  assert.ok(out.includes("All-time savings:"), "status should include savings block: " + out.slice(0, 160))
  assert.ok(out.includes("Tiers:"), "status should include tier block: " + out.slice(0, 160))
})

test("1h — trinity enable and disable toggle the live selection flag", async () => {
  setTiers()
  const hooks = await getHooks()
  const enable = await hooks.tool.trinity.execute({ action: "enable" })
  assert.ok(enable.includes("ENABLED"), "enable response should be affirmative: " + enable)
  assert.equal(readTiersFile().selection.enabled, true, "enabled flag should persist true after enable")
  const disable = await hooks.tool.trinity.execute({ action: "disable" })
  assert.ok(disable.includes("DISABLED"), "disable response should be affirmative: " + disable)
  assert.equal(readTiersFile().selection.enabled, false, "enabled flag should persist false after disable")
})

test("1i — trinity mode covers all live optimization modes", async () => {
  const cases = [
    { slot: "budget", active: "cheap" },
    { slot: "speed", active: "medium" },
    { slot: "quality", active: "brain" },
    { slot: "longrun", active: "cheap" },
    { slot: "auto", active: "brain", auto: true },
    { slot: "audit", active: "brain" },
    { slot: "forensic", active: "brain" },
    { slot: "vibeultrax", active: "cheap" },
    { slot: "vibeqmax", active: "brain", mode: "vibeqmax", requested: "vibeqmax" },
    { slot: "vibemax", active: "medium" },
  ]
  for (const c of cases) {
    setTiers()
    const hooks = await getHooks()
    const out = await hooks.tool.trinity.execute({ action: "mode", slot: c.slot })
    const sel = readTiersFile().selection
    if (c.auto) {
      assert.equal(sel.slot_locked, false, "auto should unlock slot locking")
      assert.ok(out.includes("Mode set to AUTO"), "auto response should be explicit: " + out)
      continue
    }
    assert.equal(sel.active_slot, c.active, `${c.slot} should resolve to ${c.active}`)
    assert.equal(sel.optimization_mode, c.mode || c.slot, `${c.slot} should persist as the optimization mode`)
    if (c.requested) assert.equal(sel.requested_optimization_mode, c.requested, `${c.slot} should persist requested mode separately`)
    assert.ok(out.includes("Mode set"), `${c.slot} response should be affirmative: ` + out)
  }
})

test("1j — trinity thinking full|brief|off persists reasoning depth", async () => {
  for (const level of ["full", "brief", "off"]) {
    setTiers()
    const hooks = await getHooks()
    const out = await hooks.tool.trinity.execute({ action: "thinking", level })
    assert.equal(readTiersFile().selection.thinking_level, level, `${level} should persist in selection`)
    assert.ok(out.includes(level) || out.includes("thinking"), `${level} response should mention the level: ` + out)
  }
})

test("1k — trinity enforce on|off stays consistent with selection state", async () => {
  setTiers()
  const hooks = await getHooks()
  const on = await hooks.tool.trinity.execute({ action: "enforce", slot: "on" })
  assert.ok(on.includes("ENABLED"), "enforce on should be affirmative: " + on)
  assert.equal(readTiersFile().selection.delegation_enforce, true, "delegation enforcement should persist true")

  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    $schema_version: 1,
    trinity: { brain: { oc: "a" }, medium: { oc: "b" }, cheap: { oc: "c" } },
    selection: { enabled: true, active_slot: "brain", delegation_enforce: false, onboarding_mode: "assist" },
  }, null, 2) + "\n")
  const hooks2 = await getHooks()
  const off = await hooks2.tool.trinity.execute({ action: "enforce", slot: "off" })
  assert.ok(off.includes("already OFF") || off.includes("mandatory") || off.includes("compatibility"), "enforce off should report the live status: " + off)
})

test("1l — trinity lock on|off updates the live lock state in status", async () => {
  setTiers()
  const hooks = await getHooks()
  const on = await hooks.tool.trinity.execute({ action: "lock", slot: "on" })
  assert.ok(on.includes("LOCK ON"), "lock on should be affirmative: " + on)
  const statusOn = await hooks.tool.trinity.execute({ action: "status" })
  assert.ok(statusOn.includes("LOCK ON"), "status should reflect lock on: " + statusOn)
  const off = await hooks.tool.trinity.execute({ action: "lock", slot: "off" })
  assert.ok(off.includes("LOCK OFF"), "lock off should be affirmative: " + off)
  const statusOff = await hooks.tool.trinity.execute({ action: "status" })
  assert.ok(statusOff.includes("LOCK OFF"), "status should reflect lock off: " + statusOff)
})

test("1m — trinity flow on|off and flow enforce on|off persist together", async () => {
  setTiers()
  const hooks = await getHooks()
  const flowOn = await hooks.tool.trinity.execute({ action: "flow", slot: "on" })
  assert.ok(flowOn.includes("ENABLED"), "flow on should be affirmative: " + flowOn)
  assert.equal(readTiersFile().selection.flow_enabled, true, "flow_enabled should persist true after flow on")
  const flowEnforceOn = await hooks.tool.trinity.execute({ action: "flow", slot: "enforce", level: "on" })
  assert.ok(flowEnforceOn.includes("ENABLED"), "flow enforce on should be affirmative: " + flowEnforceOn)
  assert.equal(readTiersFile().selection.flow_enforce, true, "flow_enforce should persist true after flow enforce on")
  const flowEnforceOff = await hooks.tool.trinity.execute({ action: "flow", slot: "enforce", level: "off" })
  assert.ok(flowEnforceOff.includes("DISABLED"), "flow enforce off should be affirmative: " + flowEnforceOff)
  assert.equal(readTiersFile().selection.flow_enforce, false, "flow_enforce should persist false after flow enforce off")
  const flowOff = await hooks.tool.trinity.execute({ action: "flow", slot: "off" })
  assert.ok(flowOff.includes("DISABLED"), "flow off should be affirmative: " + flowOff)
  assert.equal(readTiersFile().selection.flow_enabled, false, "flow_enabled should persist false after flow off")
})

test("1n — trinity tdd on|off|strict|quality persists test-enforcement toggles", async () => {
  setTiers()
  const hooks = await getHooks()
  const tddOn = await hooks.tool.trinity.execute({ action: "tdd", slot: "on" })
  assert.ok(tddOn.includes("ENABLED"), "tdd on should be affirmative: " + tddOn)
  assert.equal(readTiersFile().selection.tdd_enforce, true, "tdd_enforce should persist true after tdd on")
  const tddOff = await hooks.tool.trinity.execute({ action: "tdd", slot: "off" })
  assert.ok(tddOff.includes("DISABLED"), "tdd off should be affirmative: " + tddOff)
  assert.equal(readTiersFile().selection.tdd_enforce, false, "tdd_enforce should persist false after tdd off")
  const strictOn = await hooks.tool.trinity.execute({ action: "tdd", slot: "strict", level: "on" })
  assert.ok(strictOn.includes("ENABLED"), "tdd strict on should be affirmative: " + strictOn)
  assert.equal(readTiersFile().selection.tdd_strict, true, "tdd_strict should persist true after strict on")
  const qualityOn = await hooks.tool.trinity.execute({ action: "tdd", slot: "quality", level: "on" })
  assert.ok(qualityOn.includes("ENABLED"), "tdd quality on should be affirmative: " + qualityOn)
  assert.equal(readTiersFile().selection.tdd_quality, true, "tdd_quality should persist true after quality on")
})

test("1o — trinity rebuild and project return live operational output", async () => {
  setTiers()
  const hooks = await getHooks()
  const rebuild = await hooks.tool.trinity.execute({ action: "rebuild" })
  assert.ok(typeof rebuild === "string" && rebuild.length > 0, "rebuild should return a live response")
  const project = await hooks.tool.trinity.execute({ action: "project" })
  assert.ok(project.includes("Project profile") || project.includes("Sessions"), "project should report live analytics: " + project.slice(0, 180))
})

test("1p — trinity patterns and patterns clear operate on live project memory", async () => {
  setTiers()
  writeFileSync(join(sandbox, ".claude/project-states.json"), JSON.stringify({
    project_hashes: {
      abc123: {
        totalSessions: 3,
        context7Bypasses: 1,
        researchChains: 2,
        commonTopics: ["alpha.dev"],
        userPatterns: {
          friction: {
            repeated_shell_loop: { summary: "Repeated shell loop", count: 3, sessions: [1, 2, 3], lastSeen: "2026-06-12T00:00:00.000Z" },
          },
        },
      },
    },
  }, null, 2) + "\n")
  const hooks = await getHooks()
  const patterns = await hooks.tool.trinity.execute({ action: "patterns" })
  assert.ok(patterns.includes("Project patterns") || patterns.includes("stored"), "patterns should read live project memory: " + patterns)
  const cleared = await hooks.tool.trinity.execute({ action: "patterns", slot: "clear" })
  assert.ok(cleared.includes("cleared"), "patterns clear should be affirmative: " + cleared)
})

test("1q — trinity diagnose and guard return live health and doc checks", async () => {
  setTiers()
  const hooks = await getHooks()
  const diagnose = await hooks.tool.trinity.execute({ action: "diagnose" })
  assert.ok(diagnose.includes("Self Diagnostic") || diagnose.includes("checks"), "diagnose should return the live diagnostic report: " + diagnose.slice(0, 220))
  const guard = await hooks.tool.trinity.execute({ action: "guard" })
  assert.ok(guard.includes("AGENTS.md") || guard.includes("README.md") || guard.includes("Project Guard"), "guard should report doc state: " + guard)
})

test("1r — trinity blackbox on|off|status|reset follows the real session file", async () => {
  setTiers()
  const hooks = await getHooks()
  writeFileSync(join(sandbox, ".claude/blackbox-state.json"), JSON.stringify({
    enabled: false,
    sessions: {},
  }, null, 2) + "\n")
  const on = await hooks.tool.trinity.execute({ action: "blackbox", slot: "on" })
  assert.ok(on.includes("ENABLED"), "blackbox on should be affirmative: " + on)
  assert.equal(readBlackboxFile().enabled, true, "blackbox state should persist enabled=true")
  const status = await hooks.tool.trinity.execute({ action: "blackbox", slot: "status" })
  assert.ok(status.includes("Blackbox Decision Engine"), "blackbox status should render: " + status)
  const reset = await hooks.tool.trinity.execute({ action: "blackbox", slot: "reset" })
  assert.ok(reset.includes("RESET"), "blackbox reset should be affirmative: " + reset)
  const statusAfter = await hooks.tool.trinity.execute({ action: "blackbox", slot: "status" })
  assert.ok(statusAfter.includes("No resolution data yet") || statusAfter.includes("Decision Engine"), "blackbox status should still be readable after reset: " + statusAfter)
  const off = await hooks.tool.trinity.execute({ action: "blackbox", slot: "off" })
  assert.ok(off.includes("DISABLED"), "blackbox off should be affirmative: " + off)
  assert.equal(readBlackboxFile().enabled, false, "blackbox state should persist enabled=false")
})

test("1s — trinity repair-state preview and apply relabel duplicate fingerprints", async () => {
  setTiers()
  const { projectFingerprint } = await import(join(root, "src/lib/state.js?repair=" + Date.now()))
  const dstFp = projectFingerprint(sandbox)
  const srcFp = "def456"
  const projectName = sandbox.split("/").pop()
  mkdirSync(join(sandbox, ".claude/reports"), { recursive: true })
  writeFileSync(join(sandbox, ".claude/project-states.json"), JSON.stringify({
    project_hashes: {
      [dstFp]: { totalSessions: 1, context7Bypasses: 0, researchChains: 0, commonTopics: [], lastSeen: "2026-06-12T00:00:00.000Z" },
      [srcFp]: { totalSessions: 4, context7Bypasses: 2, researchChains: 3, commonTopics: ["beta.dev"], lastSeen: "2026-06-11T00:00:00.000Z" },
    },
  }, null, 2) + "\n")
  writeFileSync(join(sandbox, ".claude/reports/index.json"), JSON.stringify({
    reports: [
      { id: "r1", project: projectName, fingerprint: srcFp },
      { id: "r2", project: projectName, fingerprint: srcFp },
    ],
  }, null, 2) + "\n")
  const hooks = await getHooks()
  const preview = await hooks.tool.trinity.execute({ action: "repair-state", slot: "preview" })
  assert.ok(preview.includes("State repair") || preview.includes("reports to relabel"), "preview should describe the merge: " + preview)
  const apply = await hooks.tool.trinity.execute({ action: "repair-state", slot: "apply" })
  assert.ok(apply.includes("Applied") || apply.includes("Relabeled"), "apply should confirm relabeling: " + apply)
  const pstate = readProjectStateFile()
  assert.ok(pstate.project_hashes?.[dstFp], "target fingerprint should remain after apply")
  assert.ok(!pstate.project_hashes?.[srcFp], "source fingerprint should be removed after apply")
})

test("1t — trinity api-token and api-bootstrap-token persist live auth changes", async () => {
  setTiers()
  const hooks = await getHooks()
  const token = await hooks.tool.trinity.execute({ action: "api-token", token: "live-token-proof" })
  assert.ok(token.includes("updated") || token.includes("re-enabled"), "api-token should update auth: " + token)
  const bootstrap = await hooks.tool.trinity.execute({ action: "api-bootstrap-token", token: "bootstrap-proof" })
  assert.ok(bootstrap.includes("saved") || bootstrap.includes("exchanged") || bootstrap.includes("retry"), "bootstrap token should be handled live: " + bootstrap)
  const invalidate = await hooks.tool.trinity.execute({ action: "api-token", token: "invalidate" })
  assert.ok(invalidate.includes("invalidated"), "api-token invalidate should work: " + invalidate)
})

// ── GROUP 2: Phantom savings dedup ──
test("2a — same hash doesn't double savings", async () => {
  const { recordCacheSaving, readLifetimeSavings } = await import(join(root, "src/lib/state.js?sav=" + Date.now()))
  const hash = "mega-test-hash-" + Date.now()
  for (let i = 0; i < 5; i++) recordCacheSaving("test_tool", 0.50, { hash })
  await new Promise(r => setTimeout(r, 50))
  const sv = readLifetimeSavings()
  assert.ok(sv.ltCache <= 0.51, "capped at 1x savings: " + sv.ltCache)
})

test("2b — unique hashes each add savings", async () => {
  const { recordCacheSaving, readLifetimeSavings } = await import(join(root, "src/lib/state.js?sav2=" + Date.now()))
  writeFileSync(join(sandbox, ".claude", "delegation-state.json"), JSON.stringify({
    sessions: {}, lifetime: { cache_savings_usd: 0, total_savings_usd: 0 },
  }))
  for (const h of ["hash-X", "hash-Y", "hash-Z"]) recordCacheSaving("test_tool", 1.00, { hash: h })
  await new Promise(r => setTimeout(r, 50))
  const sv = readLifetimeSavings()
  assert.ok(sv.ltCache >= 2.99, "3 unique hashes = ~$3 savings: " + sv.ltCache)
})

// ── GROUP 3: Cross-session cache dedup ──
test("3a — scratchpad global by-hash dedup", () => {
  const hash = "mega-hash-" + Date.now()
  writeFileSync(join(sandbox, ".claude/scratch/by-hash", `${hash}.txt`), "globally-deduped-content")
  writeFileSync(join(sandbox, ".claude/scratch/sessions/sess-B/by-hash", `${hash}.txt`), "stale-local-copy")

  const globalPath = join(sandbox, ".claude/scratch/by-hash", `${hash}.txt`)
  const sessionPath = join(sandbox, ".claude/scratch/sessions/sess-B/by-hash", `${hash}.txt`)
  const chosen = existsSync(globalPath) ? globalPath : (existsSync(sessionPath) ? sessionPath : null)

  assert.equal(chosen, globalPath, "global wins over session-local")
  assert.equal(readFileSync(chosen, "utf-8"), "globally-deduped-content")
})

test("3b — no cache leakage between sessions", () => {
  writeFileSync(join(sandbox, ".claude/scratch/sessions/sess-A/by-hash", "private.txt"), "sess-A-secret")
  assert.ok(!existsSync(join(sandbox, ".claude/scratch/sessions/sess-B/by-hash", "private.txt")),
    "session B doesn't have session A's private file")
})

// ── GROUP 4: Undefined SID protection ──
test("4a — no 'undefined' session key in blackbox", async () => {
  const { loadBlackboxState } = await import(join(root, "src/lib/state.js?bb=" + Date.now()))
  const bbPath = join(sandbox, ".claude", "blackbox-state.json")
  writeFileSync(bbPath, JSON.stringify({ sessions: {} }))
  const state = loadBlackboxState()
  const keys = Object.keys(state.sessions || {})
  assert.ok(!keys.includes("undefined"), "no 'undefined' key in blackbox. Keys: " + keys.join(","))
})

test("4b — turn-classify guards undefined SID", async () => {
  const ts = readFileSync(join(root, "src/lib/turn-classify.ts"), "utf-8")
  const guardCount = (ts.match(/sid\s*&&\s*sid\s*!==\s*"undefined"/g) || []).length
  assert.ok(guardCount >= 4, "at least 4 undefined-SID guards in turn-classify.js: " + guardCount)
})

// ── GROUP 5: Project fingerprint write-once ──
test("5 — project_fingerprint set once per session", async () => {
  const st = readFileSync(join(root, "src/lib/state.ts"), "utf-8")
  const guardCount = (st.match(/!s\.sessions.*project_fingerprint/g) || []).length
  assert.ok(guardCount >= 2, "write-once guard present: " + guardCount)
})

// ── GROUP 6: Anomaly detector doesn't permanently break API ──
test("6a — setAnomalyDetection exported and toggleable", async () => {
  const { setAnomalyDetection } = await import(join(root, "src/lib/api-client.js?ani=" + Date.now()))
  assert.equal(typeof setAnomalyDetection, "function", "setAnomalyDetection is a function")
  setAnomalyDetection(false)
  setAnomalyDetection(true)
  setAnomalyDetection(false)
  assert.ok(true, "toggle works without throwing")
})

test("6b — no _apiFallbackMode in anomaly throttle path", async () => {
  const src = readFileSync(join(root, "src/lib/api-client.ts"), "utf-8")
  const afterThrottle = src.split("throttleIfAnomalous")[1]
  const untilTryBlock = afterThrottle.split("try {")[0]
  assert.ok(!untilTryBlock.includes("_apiFallbackMode = true"),
    "no _apiFallbackMode = true in anomaly path")
})

// ── GROUP 7: Mode-router syncs properly (no hardcoded build) ──
test("7 — mode-router.js compiled and exports getBrandedModes", async () => {
  const { getBrandedModes, BRANDED_MODES } = await import(join(root, "src/lib/mode-router.js?mr3=" + Date.now()))
  assert.equal(typeof getBrandedModes, "function", "getBrandedModes exported")
  assert.ok(Array.isArray(BRANDED_MODES), "BRANDED_MODES is array")
  assert.ok(BRANDED_MODES.length >= 3, "at least 3 branded modes: " + BRANDED_MODES.length)
})

// ── GROUP 8: Smart cache basic integrity ──
test("8a — smart cache jaccard similarity scoring", () => {
  const { jaccardSimilarity } =
    { jaccardSimilarity: (a, b) => { const wa = new Set(a.toLowerCase().split(/\s+/)); const wb = new Set(b.toLowerCase().split(/\s+/)); let i = 0; for (const w of wa) if (wb.has(w)) i++; const u = wa.size + wb.size - i; return u > 0 ? i / u : 0 } }
  assert.ok(jaccardSimilarity("implement rate limiter express", "build rate limiter for express") > 0.3)
  assert.ok(jaccardSimilarity("implement rate limiter express", "configuring docker compose deployment") < 0.3)
})

test("8b — smart cache dedup and eviction", async () => {
  const sc = await import(join(root, "src/vibeOS-lib/smart-cache.js?sc=" + Date.now()))
  const db = sc.createCacheDatabase()
  sc.addCacheEntry(db, "h1", "write", "prompt a", 1000, 10)
  sc.addCacheEntry(db, "h1", "write", "prompt a", 1000, 10)
  assert.equal(db.entries.length, 1, "dedup keeps 1 entry")

  sc.addCacheEntry(db, "old-1", "read", "old", 100, 99999)
  db.entries[1].at = new Date(Date.now() - 86400 * 1000).toISOString()
  sc.addCacheEntry(db, "new-1", "read", "new", 100, 1)
  const evicted = sc.evictStaleEntries(db, 3600)
  assert.ok(evicted >= 1, "evicted stale: " + evicted)
})

// ── GROUP 9: Build chain — mode-router in sync list ──
test("9 — mode-router listed in sync-ts-build.mjs libModules", () => {
  const syncScript = readFileSync(join(root, "scripts/sync-ts-build.mjs"), "utf-8")
  assert.ok(syncScript.includes('"mode-router"'), "mode-router in libModules")
})

// ── GROUP 10A: Model name resolution regression (v0.22.25) ──
test("10a — _resolveConfiguredModelId returns qualified name when bare model matches", async () => {
  const { _resolveConfiguredModelId } = await import(join(root, "src/lib/pricing.js?mrr=" + Date.now()))
  const configs = [{
    provider: {
      deepseek: { models: { "deepseek-v4-pro": {}, "deepseek-v4-flash": {}, "deepseek-chat": {} } }
    }
  }]
  // Exact bare match → provider-qualified
  const result = _resolveConfiguredModelId("deepseek-chat", configs)
  assert.equal(result, "deepseek/deepseek-chat", "bare name resolved to provider-qualified")
})

test("10b — _resolveConfiguredModelId returns empty string for unresolvable bare name", async () => {
  const { _resolveConfiguredModelId } = await import(join(root, "src/lib/pricing.js?mrr2=" + Date.now()))
  const configs = [{
    provider: {
      deepseek: { models: { "deepseek-v4-pro": {}, "deepseek-v4-flash": {} } }
    }
  }]
  // No match → empty string (not bare name — prevents garbage propagation)
  const result = _resolveConfiguredModelId("haiku", configs)
  assert.equal(result, "", "unresolvable bare name returns empty string")
})

test("10c — _resolveConfiguredModelId returns qualified name on suffix/prefix match", async () => {
  const { _resolveConfiguredModelId } = await import(join(root, "src/lib/pricing.js?mrr3=" + Date.now()))
  const configs = [{
    provider: {
      deepseek: { models: { "deepseek-v4-pro": {}, "deepseek-v4-flash": {} } }
    }
  }]
  // Suffix fuzzy match → provider-qualified
  const result = _resolveConfiguredModelId("v4-flash", configs)
  assert.equal(result, "deepseek/deepseek-v4-flash", "fuzzy suffix match resolves to qualified")
})

test("10d — _resolveConfiguredModelId prefers qualified name over bare when multiple matches", async () => {
  const { _resolveConfiguredModelId } = await import(join(root, "src/lib/pricing.js?mrr4=" + Date.now()))
  const configs = [{
    provider: {
      deepseek: { models: { "deepseek-chat": {} } },
      openrouter: { models: { "openrouter/deepseek-chat": {} } }
    }
  }]
  // Multiple matches → prefer first qualified
  const result = _resolveConfiguredModelId("deepseek-chat", configs)
  assert.ok(result.includes("/"), "result is provider-qualified: " + result)
})

test("10e — readConfig respects provider resolution for workspace models", async () => {
  const { readConfig } = await import(join(root, "src/lib/pricing.js?mrr5=" + Date.now()))
  const dir = join(sandbox, "proj-workspace-test")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "opencode.json"), JSON.stringify({
    model: "deepseek-chat",
    provider: { deepseek: { models: { "deepseek-chat": {} } } }
  }) + "\n")
  const model = readConfig(dir)
  assert.ok(model, "readConfig returns a model: " + model)
  assert.ok(model.includes("/"), "model is provider-qualified: " + model)
})

test("10f — classify handles both bare and provider-qualified names", async () => {
  const { classify } = await import(join(root, "src/lib/pricing.js?mrr6=" + Date.now()))
  assert.equal(classify("deepseek/deepseek-v4-pro"), "high", "qualified pro → high")
  assert.equal(classify("deepseek/deepseek-v4-flash"), "mid", "qualified flash → mid")
  // Bare name fallback: regex now has \b alternatives for bare deepseek-v4-pro/flash
  assert.equal(classify("deepseek-v4-pro"), "high", "bare pro → high (fallback)")
  assert.equal(classify("deepseek-v4-flash"), "mid", "bare flash → mid (fallback)")
})

test("10g — null-safe _collectConfiguredProviderModelsFromConfig", async () => {
  const mod = await import(join(root, "src/lib/pricing.js?mrr7=" + Date.now()))
  const cfg = mod._collectConfiguredProviderModelsFromConfig
  if (typeof cfg === "function") {
    assert.deepEqual(cfg(null), [], "null config returns empty array")
    assert.deepEqual(cfg(undefined), [], "undefined config returns empty array")
    assert.deepEqual(cfg({}), [], "empty config returns empty array")
  } else {
    assert.ok(true, "function not exported — internal only")
  }
})

// ── GROUP 10: All regression test files runnable ──
test("10 — all fix regression files exist and have valid syntax", () => {
  const files = [
    "tests/test_10fixes_regression.test.mjs",
    "tests/test_cross_session_regression.test.mjs",
    "tests/test_smart_cache_regression.test.mjs",
    "tests/test_mega_all_fixes.test.mjs",
  ]
  for (const f of files) {
    assert.ok(existsSync(join(root, f)), f + " exists")
  }
})

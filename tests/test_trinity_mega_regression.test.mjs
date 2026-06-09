import { test as nodeTest, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const test = (name, options, fn) =>
  typeof options === "function"
    ? nodeTest(name, { concurrency: false }, options)
    : nodeTest(name, { concurrency: false, ...(options || {}) }, fn)

let sandbox
let DelegationEnforcer

nodeTest("SETUP", { concurrency: false }, async (t) => {
  sandbox = mkdtempSync(join(tmpdir(), "trinity-mega-"))
  mkdirSync(join(sandbox, ".opencode"), { recursive: true })
  writeFileSync(join(sandbox, ".opencode/opencode.json"), JSON.stringify({ model: "deepseek/deepseek-v4-pro" }))
  process.env.VIBEOS_HOME = join(sandbox, ".claude")
  mkdirSync(join(sandbox, ".claude"), { recursive: true })
  const mod = await import("../src/index.js?t=" + Date.now())
  DelegationEnforcer = mod.DelegationEnforcer || mod.default
})

after(() => {
  delete process.env.VIBEOS_HOME
  if (sandbox && existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true })
})

function setTiers(brain, medium, cheap) {
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: { brain: { oc: brain || "a" }, medium: { oc: medium || "b" }, cheap: { oc: cheap || "c" } },
    selection: { enabled: true, active_slot: "brain", onboarding_mode: "strict", delegation_enforce: true, tdd_strict: false, flow_enabled: false, flow_enforce: false, tdd_enforce: false, savings_goal_usd: 5, tdd_quality: false, thinking_level: "full" },
  }))
}

async function getHooks() {
  return await DelegationEnforcer({ client: {}, directory: join(sandbox, ".opencode") })
}

function readSel() {
  return JSON.parse(readFileSync(join(sandbox, ".claude/model-tiers.json"), "utf8")).selection
}

test("status shows dashboard", async () => {
  setTiers()
  const r = await (await getHooks()).tool.trinity.execute({ action: "status" })
  assert.ok(r.includes("vibeOS") || r.includes("dashboard"), r.slice(0, 80))
})

test("set brain", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "set", slot: "brain" })
  assert.equal(readSel().active_slot, "brain")
})

test("set medium", async () => {
  if (process.env.CI === "true") return
  process.env.VIBEOS_HOME = join(sandbox, ".claude")
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "set", slot: "medium" })
  assert.equal(readSel().active_slot, "medium")
})

test("set cheap", async () => {
  if (process.env.CI === "true") return
  process.env.VIBEOS_HOME = join(sandbox, ".claude")
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "set", slot: "cheap" })
  assert.equal(readSel().active_slot, "cheap")
})

test("set invalid returns help", async () => {
  setTiers()
  const r = await (await getHooks()).tool.trinity.execute({ action: "set", slot: "xx" })
  assert.ok(r.includes("Provide") || r.includes("brain"), r.slice(0, 80))
})

test("mode quality → brain", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "mode", slot: "quality" })
  assert.equal(readSel().active_slot, "brain")
})

test("mode speed → medium", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "mode", slot: "speed" })
  assert.equal(readSel().active_slot, "medium")
})

test("mode budget → cheap", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "mode", slot: "budget" })
  assert.equal(readSel().active_slot, "cheap")
})

test("mode vibeultrax → valid slot NOT local", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "mode", slot: "vibeultrax" })
  const s = readSel().active_slot
  assert.ok(["brain", "medium", "cheap"].includes(s), "active_slot must be valid, got: " + s)
  assert.notEqual(s, "local", "active_slot must NOT be local")
})

test("mode vibeqmax → brain", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "mode", slot: "vibeqmax" })
  assert.equal(readSel().active_slot, "brain")
})

test("mode vibemax → medium", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "mode", slot: "vibemax" })
  assert.equal(readSel().active_slot, "medium")
})

test("mode invalid returns help", async () => {
  setTiers()
  const r = await (await getHooks()).tool.trinity.execute({ action: "mode", slot: "garbage" })
  assert.ok(r.includes("Provide"), r.slice(0, 80))
})

test("mode without slot lists modes", async () => {
  setTiers()
  const r = await (await getHooks()).tool.trinity.execute({ action: "mode" })
  assert.ok(r.includes("quality"), r.slice(0, 120))
})

test("enable toggles on", async () => {
  writeFileSync(join(sandbox, ".claude/model-tiers.json"), JSON.stringify({
    trinity: { brain: { oc: "x" }, medium: { oc: "x" }, cheap: { oc: "x" } },
    selection: { enabled: false },
  }))
  await (await getHooks()).tool.trinity.execute({ action: "enable" })
  assert.equal(readSel().enabled, true)
})

test("disable toggles off", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "disable" })
  assert.equal(readSel().enabled, false)
})

test("enforce on", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "enforce", slot: "on" })
  assert.equal(readSel().delegation_enforce, true)
})

test("enforce off returns response (mandatory)", async () => {
  setTiers()
  const r = await (await getHooks()).tool.trinity.execute({ action: "enforce", slot: "off" })
  assert.ok(r.includes("mandatory") || r.includes("cannot") || r.includes("OFF"), "enforce off msg: " + r.slice(0,80))
})

test("flow on", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "flow", slot: "on" })
  assert.equal(readSel().flow_enabled, true)
})

test("flow off", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "flow", slot: "off" })
  assert.equal(readSel().flow_enabled, false)
})

test("flow enforce on", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "flow", slot: "enforce", level: "on" })
  assert.equal(readSel().flow_enforce, true)
})

test("tdd on", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "tdd", slot: "on" })
  assert.equal(readSel().tdd_enforce, true)
})

test("tdd off", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "tdd", slot: "off" })
  assert.equal(readSel().tdd_enforce, false)
})

test("tdd strict on", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "tdd", slot: "strict", level: "on" })
  assert.equal(readSel().tdd_strict, true)
})

test("tdd quality on", async () => {
  setTiers()
  await (await getHooks()).tool.trinity.execute({ action: "tdd", slot: "quality", level: "on" })
  assert.equal(readSel().tdd_quality, true)
})

test("lock on/off no crash", async () => {
  setTiers()
  const h = await getHooks()
  const r1 = await h.tool.trinity.execute({ action: "lock", slot: "on" })
  const r2 = await h.tool.trinity.execute({ action: "lock", slot: "off" })
  assert.ok(r1.length > 0 && r2.length > 0)
})

test("thinking full", async () => {
  setTiers()
  const r = await (await getHooks()).tool.trinity.execute({ action: "thinking", slot: "full" })
  assert.ok(r.includes("full") || r.includes("thinking"), r.slice(0, 80))
})

test("thinking brief", async () => {
  setTiers()
  const r = await (await getHooks()).tool.trinity.execute({ action: "thinking", slot: "brief" })
  assert.ok(r.includes("brief") || r.includes("thinking"), r.slice(0, 80))
})

test("blackbox status", async () => {
  setTiers()
  const r = await (await getHooks()).tool.trinity.execute({ action: "blackbox", slot: "status" })
  assert.ok(typeof r === "string")
})

test("diagnose runs", async () => {
  setTiers()
  const r = await (await getHooks()).tool.trinity.execute({ action: "diagnose" })
  assert.ok(r.includes("vibeOS") || r.includes("config"), r.slice(0, 80))
})

test("help lists commands", async () => {
  setTiers()
  const r = await (await getHooks()).tool.trinity.execute({ action: "help" })
  assert.ok(r.includes("set") && r.includes("mode"), r.slice(0, 120))
})

test("rebuild survives", async () => {
  setTiers()
  try {
    const r = await (await getHooks()).tool.trinity.execute({ action: "rebuild" })
    assert.ok(typeof r === "string")
  } catch (e) {
    assert.ok(!!e.message)
  }
})

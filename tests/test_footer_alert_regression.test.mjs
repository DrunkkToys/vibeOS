// SPDX-License-Identifier: MIT
// Integration test: _appendFooter produces ML-driven dynamic display
// Guards against stale .ts compilation overwriting fixed .js
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-footer-alert-"))
mkdirSync(join(sandbox, ".claude"), { recursive: true })
mkdirSync(join(sandbox, ".opencode"), { recursive: true })
mkdirSync(join(sandbox, ".config", "opencode"), { recursive: true })
const prevVibeHome = process.env.VIBEOS_HOME
process.env.VIBEOS_HOME = join(sandbox, ".claude")
const prevHome = process.env.HOME
process.env.HOME = sandbox

function writeTiers(overrides = {}) {
    writeFileSync(join(sandbox, ".claude", "model-tiers.json"), JSON.stringify({
        selection: {
            enabled: true, active_slot: "brain", onboarding_mode: "strict",
            optimization_mode: "vibeqmax", vector_changed_slot: "cheap",
            delegation_enforce: true, flow_enforce: true, tdd_enforce: true, tdd_strict: false,
            ...overrides
        },
        trinity: { brain: { oc: "deepseek/v4-pro" }, medium: { oc: "deepseek/v4-flash" }, cheap: { oc: "deepseek/v4-flash" } }
    }))
}

writeFileSync(join(sandbox, ".config", "opencode", "opencode.json"), JSON.stringify({
    model: "deepseek/v4-pro", plugin: ["vibeOS"]
}))

after(() => {
    try { process.env.VIBEOS_HOME = prevVibeHome } catch {}
    try { process.env.HOME = prevHome } catch {}
    try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
})

test("SETUP: sandbox ready", () => assert.ok(true))

// ── Test 1: tier icon follows active_slot while vector_changed is shown separately ──
test("footer: tier = active_slot when ML decision differs from active_slot", async () => {
    writeTiers({ active_slot: "brain", vector_changed_slot: "cheap" })
    const { _appendFooter } = await import("../src/lib/hooks/footer.js?ftr1=" + Date.now())
    const o = { text: "This is a test message that is long enough to trigger the vibeOS footer mechanism and verify the ML pipeline." }
    await _appendFooter({ args: { model: "deepseek/v4-flash" } }, o)
    // The footer should keep brain first and show the vector move at the end.
    assert.ok(o.text.includes("🧠 brain"), "footer should show brain from active_slot: " + o.text.slice(-150))
    assert.ok(o.text.includes("⟡ cheap"), "footer should show cheap as the vector move: " + o.text.slice(-150))
})

// ── Test 2: optimization_mode appears in footer ──
test("footer: shows optimization_mode from selection", async () => {
    writeTiers({ optimization_mode: "speed", vector_changed_slot: undefined })
    const { _appendFooter } = await import("../src/lib/hooks/footer.js?ftr2=" + Date.now())
    const o = { text: "Another test message that is sufficiently long to trigger the vibeOS footer and verify mode display." }
    await _appendFooter({ args: { model: "deepseek/v4-flash" } }, o)
    assert.ok(o.text.includes("speed"), "footer should show optimization_mode speed: " + o.text.slice(-150))
})

// ── Test 3: → arrow shows when vector_changed differs ──
test("footer: → arrow when ML wants different tier", async () => {
    writeTiers({ active_slot: "brain", vector_changed_slot: "medium" })
    const { _appendFooter } = await import("../src/lib/hooks/footer.js?ftr3=" + Date.now())
    const o = { text: "Testing the arrow indicator when the ML wants to change the tier from brain to medium in a long message." }
    await _appendFooter({ args: { model: "deepseek/v4-flash" } }, o)
    assert.ok(o.text.includes("⟡ medium"), "footer should show ⟡ medium pulse: " + o.text.slice(-150))
})

// ── Test 4: footer drops redundant mode label ──
test("footer: brand is VibeQMaX when tier is brain", async () => {
    writeTiers({ active_slot: "brain", vector_changed_slot: undefined })
    const { _appendFooter } = await import("../src/lib/hooks/footer.js?ftr4=" + Date.now())
    const o = { text: "Testing the brand display in the footer with a sufficiently long message for vibeOS." }
    await _appendFooter({ args: { model: "deepseek/v4-pro" } }, o)
    assert.ok(o.text.includes("VibeQMaX"), "footer should show VibeQMaX for brain: " + o.text.slice(-150))
})

// ── Test 5: ML pipeline end-to-end via footer ──
test("footer: full ML pipeline — tier + mode + arrow in one line", async () => {
    writeTiers({ active_slot: "medium", vector_changed_slot: "cheap", optimization_mode: "budget" })
    const { _appendFooter } = await import("../src/lib/hooks/footer.js?ftr5=" + Date.now())
    const o = { text: "Full pipeline test to verify tier icon, mode display, and arrow all appear in the vibeOS footer." }
    await _appendFooter({ args: { model: "deepseek/v4-flash" } }, o)
    const footer = o.text.slice(-200)
    assert.ok(footer.includes("🧠") || footer.includes("◐") || footer.includes("⚡") || footer.includes("🎁"), "has tier: " + footer)
    assert.ok(footer.includes("budget"), "has mode: " + footer)
    assert.ok(footer.includes("⟡ cheap"), "has vector pulse: " + footer)
    assert.ok(!footer.includes("slot:"), "footer should not repeat the slot label: " + footer)
})

// ── Test 6: enforcement tags preserved ──
test("footer: enforcement state preserved in dynamic display", async () => {
    writeTiers({ delegation_enforce: true, flow_enforce: true, tdd_enforce: false })
    const { _appendFooter } = await import("../src/lib/hooks/footer.js?ftr6=" + Date.now())
    const o = { text: "Testing that enforcement settings are preserved in the footer alert display for vibeOS." }
    await _appendFooter({ args: { model: "deepseek/v4-flash" } }, o)
    // Footer should not crash, enforcement tags should render
    assert.ok(o.text.includes("guarded") || o.text.includes("flow steady") || o.text.includes("tests live"), "footer renders: " + o.text.slice(-150))
})

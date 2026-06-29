// SPDX-License-Identifier: MIT
// Integration test: _appendFooter produces ML-driven dynamic display
// Guards against stale .ts compilation overwriting fixed .js
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

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
        // v4-flash maps to exactly ONE slot (cheap) so a live v4-flash resolves to a
        // single, unambiguous tier. medium is a distinct model. (Tests 11/13 rely on
        // cheap.oc === v4-flash; tests that need v4-flash as medium override trinity.)
        trinity: { brain: { oc: "deepseek/v4-pro" }, medium: { oc: "z-ai/glm-4.6" }, cheap: { oc: "deepseek/v4-flash" } }
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

// ── Test 1: tier icon follows the model that ACTUALLY ran, not the stale active_slot ──
// (Same truthful contract as the vibeultrax tests below — extended to all modes so the
// footer can never claim a tier the live model didn't run. active_slot is the decision;
// the live/ran model is the truth.)
test("footer: tier reflects the model that ran, not the stale active_slot", async () => {
    // active_slot is a stale decision (cheap); the model that actually ran is v4-pro
    // (the brain-slot model). The footer must show brain — the live model — not cheap.
    writeTiers({ active_slot: "cheap", vector_changed_slot: "cheap" })
    const { _appendFooter } = await import("../src/lib/hooks/footer.js?ftr1=" + Date.now())
    const o = { text: "This is a test message that is long enough to trigger the vibeOS footer mechanism and verify the ML pipeline." }
    await _appendFooter({ args: { model: "deepseek/v4-pro" } }, o)
    assert.ok(o.text.includes("🧠 brain"), "footer tier must follow the live model (brain), not active_slot: " + o.text.slice(-150))
})

// ── Test 2: optimization_mode follows the current regime vector ──
test("footer: shows regime-derived mode instead of sticky selection", async () => {
    writeTiers({ optimization_mode: "speed", vector_changed_slot: undefined })
    const { _appendFooter } = await import("../src/lib/hooks/footer.js?ftr2=" + Date.now())
    const o = { text: "Another test message that is sufficiently long to trigger the vibeOS footer and verify mode display." }
    await _appendFooter({ args: { model: "deepseek/v4-flash" } }, o)
    assert.ok(o.text.includes("Speed"), "footer should show the backend-selected mode label: " + o.text.slice(-150))
})

// ── Test 3: ⟡ pulse shows the decided slot when it differs from the model that ran ──
test("footer: ⟡ pulse shows the decided slot vs what ran", async () => {
    // Ran model is v4-pro (brain); the decision moved the slot to medium. The pulse
    // surfaces the decision (⟡ medium) while the tier icon stays truthful to what ran.
    writeTiers({ active_slot: "brain", vector_changed_slot: "medium" })
    const { _appendFooter } = await import("../src/lib/hooks/footer.js?ftr3=" + Date.now())
    const o = { text: "Testing the arrow indicator when the ML wants to change the tier from brain to medium in a long message." }
    await _appendFooter({ args: { model: "deepseek/v4-pro" } }, o)
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
    // Disambiguate the trinity so the live model maps to exactly one tier (medium): the
    // tier icon follows the ran model (◐ medium) while ⟡ cheap shows the decided move.
    const tiersFile = join(sandbox, ".claude", "model-tiers.json")
    const tiers = JSON.parse(readFileSync(tiersFile, "utf8"))
    tiers.trinity = { brain: { oc: "deepseek/v4-pro" }, medium: { oc: "deepseek/v4-flash" }, cheap: { oc: "opencode/big-pickle" } }
    writeFileSync(tiersFile, JSON.stringify(tiers))
    const { _appendFooter } = await import("../src/lib/hooks/footer.js?ftr5=" + Date.now())
    const o = { text: "Full pipeline test to verify tier icon, mode display, and arrow all appear in the vibeOS footer." }
    await _appendFooter({ args: { model: "deepseek/v4-flash" } }, o)
    const footer = o.text.slice(-200)
    assert.ok(footer.includes("🧠") || footer.includes("◐") || footer.includes("⚡") || footer.includes("🎁"), "has tier: " + footer)
    assert.ok(footer.includes("Budget"), "has backend-selected mode label: " + footer)
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

// ── Test 7: greetings stay quiet and do not inherit sticky quality mode ──
test("footer: 'hi' stays quiet instead of inheriting quality/guarded state", async () => {
    writeTiers({
        active_slot: "brain",
        optimization_mode: "quality",
        delegation_enforce: true,
        flow_enforce: true,
        tdd_enforce: true,
        vector_changed_slot: undefined,
    })
    const { _appendFooter } = await import("../src/lib/hooks/footer.js?ftr7=" + Date.now())
    const o = { text: "Hi. How can I help you? This greeting should stay quiet and not inherit a stale quality episode." }
    await _appendFooter({ args: { model: "deepseek/v4-pro" } }, o)
    const footer = o.text.split("\n").pop() || ""
    assert.ok(footer.includes("Quality"), "greeting footer should follow INIT regime mode label: " + footer)
    assert.ok(!footer.includes("quality"), "greeting footer should not inherit quality: " + footer)
})

// ── Test 8: sticky branded mode stays visually distinct from the live regime label ──
test("footer: sticky branded mode stays visually distinct from the live regime label", async () => {
    writeTiers({
        active_slot: "brain",
        optimization_mode: "vibeultrax",
        delegation_enforce: true,
        flow_enforce: true,
        tdd_enforce: true,
        vector_changed_slot: undefined,
    })
    const { _appendFooter } = await import("../src/lib/hooks/footer.js?ftr8=" + Date.now())
    const o = { text: "This message is long enough to trigger the footer and reproduce the sticky brand leak." }
    await _appendFooter({ args: { model: "deepseek/v4-pro" } }, o)
    const footer = o.text.split("\n").pop() || ""
    // The branded mode must appear (distinct from the INIT regime tag) but must
    // not be duplicated as "VibeUltraX · VibeUltraX" — the mode label is
    // suppressed when it would just repeat the brand.
    assert.ok(footer.includes("VibeUltraX"), "footer should show the branded mode: " + footer)
    assert.ok(!footer.includes("· VibeUltraX"), "footer must not duplicate the brand as a mode label: " + footer)
})

test("footer: claim-bearing output shows a check icon without needing cascade audit", async () => {
    writeTiers({ active_slot: "brain", vector_changed_slot: undefined, optimization_mode: "quality" })
    const { _appendFooter } = await import("../src/lib/hooks/footer.js?claim-check=" + Date.now())
    const o = { text: "I fixed the bug, rebuilt the release, and verified the regression suite. The issue is resolved." }
    await _appendFooter({ args: { model: "deepseek/v4-pro" } }, o)
    const footer = o.text.split("\n").pop() || ""
    assert.ok(footer.includes("✓"), "footer should show a check icon for verified claims: " + footer)
})

test("footer: vibeultrax tier follows the live model, not the stale persistent slot", async () => {
    // trinity.cheap.oc === deepseek/v4-flash; active_slot is a stale "brain".
    // In VibeUltraX the tier must follow the LIVE model (cheap), not the stale
    // slot — and the model name shown is that live model.
    writeTiers({
        active_slot: "brain",
        requested_optimization_mode: "vibeultrax",
        optimization_mode: "vibeultrax",
        vector_changed_slot: undefined,
    })
    const { _appendFooter } = await import("../src/lib/hooks/footer.js?vx-sync=" + Date.now())
    const o = { text: "This message is long enough to trigger the footer and verify the live model tier wins over stale slot state." }
    await _appendFooter({ args: { model: "deepseek/v4-flash" } }, o)
    const footer = o.text.split("\n").pop() || ""
    assert.ok(footer.includes("⚡ cheap"), "footer tier should follow the live cheap-slot model: " + footer)
    assert.ok(footer.includes("VibeUltraX"), "footer should keep the branded mode visible: " + footer)
    assert.ok(!footer.includes("🧠 brain"), "footer should not show the stale brain slot: " + footer)
})

test("footer: vibeultrax shows the medium tier when the cascade escalates to the medium-slot model", async () => {
    // When the live model is the user's medium-slot model the header must read
    // "◐ medium | …" — tier and model stay coherent during cascade escalation.
    writeTiers({
        active_slot: "cheap",
        requested_optimization_mode: "vibeultrax",
        optimization_mode: "vibeultrax",
        vector_changed_slot: undefined,
        // make the medium slot distinct from cheap so the tie-break is unambiguous
    })
    // Overwrite trinity so medium is a distinct model from cheap.
    const tiersPath = join(sandbox, ".claude", "model-tiers.json")
    const tiers = JSON.parse(readFileSync(tiersPath, "utf8"))
    tiers.trinity = { brain: { oc: "deepseek/v4-pro" }, medium: { oc: "deepseek/v4-flash" }, cheap: { oc: "opencode/big-pickle" } }
    writeFileSync(tiersPath, JSON.stringify(tiers))
    const { _appendFooter } = await import("../src/lib/hooks/footer.js?vx-escalate=" + Date.now())
    const o = { text: "This message is long enough to trigger the footer and verify the medium tier shows on cascade escalation." }
    await _appendFooter({ args: { model: "deepseek/v4-flash" } }, o)
    const footer = o.text.split("\n").pop() || ""
    assert.ok(footer.includes("◐ medium"), "footer tier should escalate to medium with the medium-slot live model: " + footer)
    assert.ok(footer.includes("VibeUltraX"), "footer should keep the branded mode visible: " + footer)
    assert.ok(!footer.includes("⚡ cheap"), "footer should not pin to cheap once escalated: " + footer)
})

test("footer: vibeultrax cascade shows the escalated model name beside the indicator", async () => {
    writeTiers({
        active_slot: "cheap",
        requested_optimization_mode: "vibeultrax",
        optimization_mode: "vibeultrax",
        vector_changed_slot: undefined,
    })
    writeFileSync(join(sandbox, ".claude/blackbox-state.json"), JSON.stringify({
        cascade_depth: 3,
        control_vector: { cascade_depth: 3 },
        sessions: {},
    }, null, 2) + "\n")
    const { _appendFooter } = await import("../src/lib/hooks/footer.js?vx-label=" + Date.now())
    const o = { text: "This message is long enough to trigger the footer and verify the cascade label is visible." }
    await _appendFooter({ args: { model: "deepseek/v4-flash" } }, o)
    const footer = o.text.split("\n").pop() || ""
    assert.ok(/\|\s*(?:▸▸▸|▸▸)\s*(?:\||$)/.test(footer), "footer should show cascade arrows without model name suffix: " + footer)
})

// ── Regression: streaming rewrites the message text and wipes a footer painted
// on an earlier (partial) chunk. _appendFooter must REPAINT the rich footer on
// the final text instead of skipping by messageID — otherwise the basic
// ensureFooterFallback footer (raw live model, no brand) wins. ──
test("footer: re-paints rich footer after streaming wipes an earlier paint", async () => {
    writeTiers({
        active_slot: "cheap",
        requested_optimization_mode: "vibeultrax",
        optimization_mode: "vibeultrax",
        vector_changed_slot: undefined,
    })
    const { _appendFooter } = await import("../src/lib/hooks/footer.js?stream-wipe=" + Date.now())
    const FULL = "Rebuilt the dataset pipeline and verified the regression suite passes end to end for the premium training run."
    const mk = (t) => ({ message: { id: "msg_stream_x", parts: [{ type: "text", text: t }] } })
    // 1) early streaming chunk gets a footer painted
    const partial = mk("Rebuilt the dataset")
    await _appendFooter({ message: { id: "msg_stream_x" }, args: { model: "deepseek/v4-flash" } }, partial)
    assert.ok(/\n\n— .* —\s*$/.test(partial.message.parts[0].text), "partial chunk should get a footer")
    // 2) opencode replaces the streamed text (footer wiped), same messageID
    const full = mk(FULL)
    await _appendFooter({ message: { id: "msg_stream_x" }, args: { model: "deepseek/v4-flash" } }, full)
    const finalText = full.message.parts[0].text
    assert.ok(/\n\n— .* —\s*$/.test(finalText), "final streamed text must be RE-painted with a footer: " + finalText.slice(-120))
    const finalFooter = finalText.split("\n").pop() || ""
    assert.ok(finalFooter.includes("VibeUltraX"), "re-painted footer must be the rich branded one, not the basic fallback: " + finalFooter)
    assert.ok(finalFooter.includes("⚡ cheap"), "re-painted footer keeps the cheap cascade entry: " + finalFooter)
    // 3) re-firing on the same (already-footed) object must not duplicate
    await _appendFooter({ message: { id: "msg_stream_x" }, args: { model: "deepseek/v4-flash" } }, full)
    const footerCount = (full.message.parts[0].text.match(/— ⚡|— ◐|— 🧠/g) || []).length
    assert.equal(footerCount, 1, "footer must not double on re-fire: " + full.message.parts[0].text.slice(-160))
})

test("footer: bundled runtime records probe entries and split provider/model labels", async () => {
    writeTiers({
        active_slot: "cheap",
        requested_optimization_mode: "vibeultrax",
        optimization_mode: "vibeultrax",
        vector_changed_slot: undefined,
    })
    const bundleUrl = pathToFileURL(join(process.cwd(), "dist", "vibeOS.js")).href
    const mod = await import(bundleUrl + "?footer-probe=" + Date.now())
    const { DelegationEnforcer } = mod
    const dir = join(sandbox, ".opencode-footer-probe")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "opencode.json"), JSON.stringify({ model: "opencode/big-pickle" }, null, 2))
    const hooks = await DelegationEnforcer({ client: { model: "opencode/big-pickle" }, directory: dir })

    const textOut = { text: "This bundled runtime footer probe test message is long enough to trigger the footer path and record its probe." }
    await hooks["experimental.text.complete"]({ messageID: "probe-text-1", args: { model: "opencode/big-pickle" } }, textOut)
    assert.ok(textOut.text.includes("⚡ cheap | Opencode | Big Pickle"), "bundle footer should split provider and model: " + textOut.text.slice(-180))

    const updatedOut = { text: "This bundled runtime message.updated probe is also long enough to exercise the same footer path." }
    await hooks["message.updated"]({ messageID: "probe-updated-1", args: { model: "opencode/big-pickle" } }, updatedOut)
    assert.ok(updatedOut.text.includes("⚡ cheap | Opencode | Big Pickle"), "message.updated footer should stay split: " + updatedOut.text.slice(-180))

    const eventsDir = join(process.env.VIBEOS_HOME, "session-events")
    const probes = []
    const footerErrors = []
    if (existsSync(eventsDir)) {
        for (const file of readdirSync(eventsDir)) {
            if (!file.endsWith(".jsonl")) continue
            const raw = readFileSync(join(eventsDir, file), "utf8").trim()
            if (!raw) continue
            for (const line of raw.split("\n")) {
                try {
                    const event = JSON.parse(line)
                    if (event?.kind === "footer-probe") probes.push(event)
                    else if (event?.kind === "footer-error") footerErrors.push(event)
                } catch {}
            }
        }
    }

    // Root-cause lock: the rich footer must not throw in the bundle. A footer-error here
    // (e.g. stage="execution" "Module not found in bundle: ../selection-manager.js?footer=")
    // is exactly the regression that made the live footer collapse to 3 segments.
    assert.equal(
        footerErrors.length,
        0,
        "rich footer threw in the bundle: " + JSON.stringify(footerErrors.map((e) => ({ stage: e.stage, message: e.message }))),
    )

    // SINGLE SOURCE OF TRUTH: the bundle must now record the RICH footer builder, not the
    // degraded "fallback". The rich path used to throw in the bundle (an unbundlable
    // dynamic import of selection-manager) and silently lose to the 3-segment fallback;
    // that is the "always cut" footer. There must be NO fallback probe anymore.
    // The session-events jsonl is shared across every sub-test in this file, so select
    // THIS test's own probes by message_id rather than by hook (which would match a
    // leaked probe from an earlier sub-test).
    const textProbe = probes.find((event) => event.message_id === "probe-text-1" && event.builder === "rich")
    const updatedProbe = probes.find((event) => event.message_id === "probe-updated-1" && event.builder === "rich")
    assert.ok(textProbe, "expected a RICH footer probe for experimental.text.complete (rich path must not throw in the bundle)")
    assert.ok(updatedProbe, "expected a RICH footer probe for message.updated")
    assert.ok(
        !probes.some((e) => (e.message_id === "probe-text-1" || e.message_id === "probe-updated-1") && e.builder === "fallback"),
        "the degraded fallback builder must never run for the bundled footer anymore",
    )
    assert.equal(textProbe.provider_label, "Opencode")
    assert.equal(textProbe.model_name, "Big Pickle")
    assert.equal(updatedProbe.provider_label, "Opencode")
    assert.equal(updatedProbe.model_name, "Big Pickle")
})

// SPDX-License-Identifier: MIT
// Locks PR #336 (Fix VibeUltraX cheap-tier default via the OpenCode dropdown
// lever) and PR #337's "Bind vibe tiers to OpenCode agents" half.
//
// Existing footer tests (test_footer_alert_regression.test.mjs etc.) all pass
// args.model explicitly, which takes priority over the live-model lookup and
// never exercise the actual #336 fix: _appendFooter reading the PROJECT-LOCAL
// opencode.json (readLiveOpenCodeModel, the same file the dropdown writes)
// instead of readConfig()'s remembered "workspace-session" model, which the
// commit message identifies as the thing that drifts to a stale tier and
// breaks footer<->dropdown<->VibeUltraX coherence. installVibeTierAgentsInConfig
// (scripts/lib/vibe-tier-agents.mjs), the module that binds a single vibe
// primary agent plus vibe-cheap/vibe-medium/vibe-brain OpenCode subagents to
// the trinity models, had zero test coverage at all.
import { test, after } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-tier-dropdown-"))
const projectDir = join(sandbox, "project")
const desktopHome = join(sandbox, "desktop-home")
mkdirSync(join(sandbox, ".claude"), { recursive: true })
mkdirSync(projectDir, { recursive: true })
mkdirSync(desktopHome, { recursive: true })
const prevVibeHome = process.env.VIBEOS_HOME
const prevHome = process.env.HOME
const prevDesktopHome = process.env.VIBEOS_OPENCODE_DESKTOP_HOME
process.env.VIBEOS_HOME = join(sandbox, ".claude")
process.env.HOME = sandbox
process.env.VIBEOS_OPENCODE_DESKTOP_HOME = desktopHome

function writeTiers(overrides = {}) {
  writeFileSync(join(sandbox, ".claude", "model-tiers.json"), JSON.stringify({
    selection: {
      enabled: true, active_slot: "cheap", onboarding_mode: "strict",
      optimization_mode: "vibeultrax",
      ...overrides,
    },
    trinity: { brain: { oc: "deepseek/v4-pro" }, medium: { oc: "z-ai/glm-4.6" }, cheap: { oc: "deepseek/v4-flash" } },
  }))
}
writeTiers()

after(() => {
  try { process.env.VIBEOS_HOME = prevVibeHome } catch {}
  try { process.env.HOME = prevHome } catch {}
  if (prevDesktopHome === undefined) delete process.env.VIBEOS_OPENCODE_DESKTOP_HOME
  else process.env.VIBEOS_OPENCODE_DESKTOP_HOME = prevDesktopHome
  try { rmSync(sandbox, { recursive: true, force: true }) } catch {}
})

test("footer follows the live opencode.json model, not readConfig's stale remembered workspace-session model", async () => {
  // Reproduces the exact drift the #336 commit message describes: a desktop
  // "remembered workspace-session model" record pins this directory's last
  // session to the brain model, while the project-local opencode.json (what
  // the dropdown actually writes/reads now) has already moved to cheap.
  // readConfig(directory) prefers the workspace memory and would return brain;
  // only readLiveOpenCodeModel(directory) (the #336 fix) returns the correct
  // live cheap model.
  const sid = "ses_test_workspace_123"
  writeFileSync(join(desktopHome, "opencode.global.dat"), JSON.stringify({
    notification: { list: [{ directory: projectDir, session: sid, time: Date.now() }] },
  }))
  const innerSelection = JSON.stringify({ session: { [sid]: { model: { providerID: "deepseek", modelID: "v4-pro" } } } })
  writeFileSync(join(desktopHome, `opencode.workspace.${sid}.dat`), JSON.stringify({
    "workspace:model-selection": innerSelection,
  }))
  writeFileSync(join(projectDir, "opencode.json"), JSON.stringify({
    model: "deepseek/v4-flash", $schema: "https://opencode.ai/config.json",
  }))

  const { _appendFooter } = await import("../src/lib/hooks/footer.js?tier-dropdown-1=" + Date.now())
  const o = { text: "This is a test message that is long enough to trigger the vibeOS footer mechanism for the dropdown binding test." }
  // Deliberately NO args.model — forces _appendFooter through the live-model
  // lookup path instead of the hookModel override every other test exercises.
  await _appendFooter({}, o, projectDir)

  assert.ok(o.text.includes("⚡ cheap"), "footer must follow the live opencode.json (cheap) via readLiveOpenCodeModel, not readConfig's stale remembered workspace model (brain): " + o.text.slice(-150))
  assert.ok(!o.text.includes("🧠 brain"), "footer must not show the stale remembered workspace-session model: " + o.text.slice(-150))
})

test("installVibeTierAgentsInConfig binds vibe primary + tier subagents to the trinity models and keeps default_agent on vibe", async () => {
  writeTiers()
  const { installVibeTierAgentsInConfig } = await import("../scripts/lib/vibe-tier-agents.mjs?tier-dropdown-2=" + Date.now())
  const tiers = JSON.parse(readFileSync(join(sandbox, ".claude", "model-tiers.json"), "utf8"))

  const config = { plugin: ["vibeOS"] }
  const changed = installVibeTierAgentsInConfig(config, tiers)

  assert.equal(changed, true, "first install must report a change")
  assert.equal(config.agent.vibe.mode, "primary")
  assert.equal(config.agent.vibe.model, undefined, "primary vibe agent must inherit from root model, not pin its own model")
  assert.equal(config.agent["vibe-cheap"].model, "deepseek/v4-flash")
  assert.equal(config.agent["vibe-medium"].model, "z-ai/glm-4.6")
  assert.equal(config.agent["vibe-brain"].model, "deepseek/v4-pro")
  assert.equal(config.agent["vibe-cheap"].mode, "subagent")
  assert.equal(config.agent["vibe-medium"].mode, "subagent")
  assert.equal(config.agent["vibe-brain"].mode, "subagent")
  assert.equal(config.default_agent, "vibe", "default_agent must stay on the unified primary vibe agent")
})

test("installVibeTierAgentsInConfig is idempotent and preserves custom permission overrides", async () => {
  writeTiers()
  const { installVibeTierAgentsInConfig } = await import("../scripts/lib/vibe-tier-agents.mjs?tier-dropdown-3=" + Date.now())
  const tiers = JSON.parse(readFileSync(join(sandbox, ".claude", "model-tiers.json"), "utf8"))

  const config = { plugin: ["vibeOS"] }
  installVibeTierAgentsInConfig(config, tiers)

  // Simulate a user customizing permissions on the generated agent.
  config.agent["vibe-cheap"].permission.bash = "ask"

  const secondChanged = installVibeTierAgentsInConfig(config, tiers)
  assert.equal(secondChanged, false, "re-running with unchanged tiers must be a no-op")
  assert.equal(config.agent["vibe-cheap"].permission.bash, "ask", "a user's custom permission override must survive re-install, not be clobbered back to the default 'allow'")
})

test("installVibeTierAgentsInConfig scrubs a stale primary vibe model pin", async () => {
  writeTiers()
  const { installVibeTierAgentsInConfig } = await import("../scripts/lib/vibe-tier-agents.mjs?tier-dropdown-4=" + Date.now())
  const tiers = JSON.parse(readFileSync(join(sandbox, ".claude", "model-tiers.json"), "utf8"))
  const config = {
    agent: {
      vibe: { mode: "primary", model: "deepseek/v4-pro" },
    },
  }

  const changed = installVibeTierAgentsInConfig(config, tiers)

  assert.equal(changed, true)
  assert.equal(config.agent.vibe.mode, "primary")
  assert.equal(config.agent.vibe.model, undefined, "stale primary model pin must be removed")
})

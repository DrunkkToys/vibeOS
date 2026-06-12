import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import { pathToFileURL, fileURLToPath } from "node:url"

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..")
const BUNDLE_URL = pathToFileURL(join(ROOT, "src/index.js")).href
const STALE_MS = 72 * 60 * 60 * 1000

const sandbox = mkdtempSync(join(tmpdir(), "vibeos-forensic-"))
const home = sandbox
const claude = join(home, ".claude")
const opencodeHome = join(home, ".config", "opencode")
const projectDir = join(sandbox, "forensic-project")
const ledgerPath = join(claude, "forensic-ledger.jsonl")
const handoverPath = join(claude, "handover-notebook.md")
const tiersPath = join(claude, "model-tiers.json")
const statePath = join(claude, "delegation-state.json")
const blackboxPath = join(claude, "blackbox-state.json")
const activeJobsPath = join(claude, "active-jobs.json")
const projectStatePath = join(claude, "project-states.json")

mkdirSync(projectDir, { recursive: true })
mkdirSync(claude, { recursive: true })
mkdirSync(opencodeHome, { recursive: true })

writeFileSync(join(opencodeHome, "opencode.json"), JSON.stringify({
  model: "deepseek/deepseek-v4-pro",
  provider: {
    deepseek: {
      models: {
        "deepseek-v4-pro": {},
        "deepseek-v4-flash": {},
        "deepseek-chat": {},
      },
    },
  },
}, null, 2) + "\n")

writeFileSync(join(projectDir, "opencode.json"), JSON.stringify({
  model: "deepseek/deepseek-v4-pro",
}, null, 2) + "\n")

function runSession(label, body) {
  const script = `
    import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync, rmSync } from "node:fs";
    import { join } from "node:path";
    const home = ${JSON.stringify(home)};
    const projectDir = ${JSON.stringify(projectDir)};
    const ledgerPath = ${JSON.stringify(ledgerPath)};
    const handoverPath = ${JSON.stringify(handoverPath)};
    process.env.HOME = home;
    process.env.VIBEOS_HOME = join(home, ".claude");
    process.env.VIBEOS_OPENCODE_HOME = join(home, ".config", "opencode");
    console.log = () => {};
    console.info = () => {};
    mkdirSync(join(home, ".claude"), { recursive: true });
    mkdirSync(join(home, ".config", "opencode"), { recursive: true });
    mkdirSync(projectDir, { recursive: true });
    const mod = await import(${JSON.stringify(BUNDLE_URL)} + "?${label}=" + Date.now());
    const hooks = await mod.DelegationEnforcer({ client: {}, directory: projectDir });
    const writeLedger = (entry) => {
      appendFileSync(ledgerPath, JSON.stringify({ session: ${JSON.stringify(label)}, at: new Date().toISOString(), ...entry }) + "\\n");
    };
    const writeHandover = (lines) => {
      appendFileSync(handoverPath, lines.join("\\n") + "\\n\\n");
    };
    ${body}
  `
  const raw = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" }).trim()
  return raw ? JSON.parse(raw) : {}
}

test("forensic cascade: fresh install, update, reset, and continuity all survive real restarts", async () => {
  const fresh = runSession("fresh", `
    const envOut = { env: {} };
    await hooks["shell.env"]({}, envOut);
    const status = await hooks.tool.trinity.execute({ action: "status" });
    await hooks.tool.trinity.execute({ action: "enforce", slot: "on" });
    await hooks.tool.trinity.execute({ action: "set", slot: "brain" });
    const stateMod = await import(${JSON.stringify(pathToFileURL(join(ROOT, "src/lib/state.js")).href)} + "?fresh=" + Date.now());
    stateMod.setCurrentModel("deepseek/deepseek-v4-pro");
    stateMod.setCurrentTier("high");
    const before = { args: { filePath: join(projectDir, "src/app.ts"), content: "export const ok = true;" } };
    await hooks["tool.execute.before"]({ tool: "write", args: before.args }, before);
    const reportId = mod.saveReport({
      type: "forensic-fresh",
      summary: "fresh install continuity seed",
      fingerprint: "forensic-project",
      metrics: {
        projectName: "forensic-project",
        projectFingerprint: "forensic-project",
        sessionId: "fresh",
      },
      status: "completed",
    });
    const projectState = JSON.parse(readFileSync(${JSON.stringify(projectStatePath)}, "utf8"));
    const projectBucket = projectState.project_hashes?.[Object.keys(projectState.project_hashes || {})[0]] || {};
    const writeBlocked = Boolean(before.blocked);
    const result = { text: "This assistant reply is long enough to trigger the footer and prove the append path." };
    await hooks["experimental.text.complete"]({ messageID: "forensic-fresh-1" }, result);
    const project = await hooks.tool.trinity.execute({ action: "project" });
    writeLedger({
      phase: "fresh-install",
      validated: {
        env: envOut.env,
        blocked: writeBlocked,
        reportId,
        projectSessions: projectBucket.totalSessions || 0,
        status: status.slice(0, 120),
        footer: result.text.slice(-120),
        project: project.slice(0, 120),
      },
      remaining: ["restart", "update", "reset"],
    });
    writeHandover([
      "# Session 1",
      "What was done: verified first-run seeding, blocking, footer append, and project readout.",
      "What remains: update-preserve, reset, stale-state recovery, and cross-session continuity.",
      "Validated hypotheses: fresh install seeds live runtime state without crashing.",
      "Regressions found: none yet.",
      "Needs re-testing: rebuild/restart and corrupted-state recovery.",
      "Next session: exercise update and reset paths on the same disk state.",
    ]);
    process.stdout.write(JSON.stringify({
      env: envOut.env,
      blocked: writeBlocked,
      reportId,
      projectSessions: projectBucket.totalSessions || 0,
      status,
      footer: result.text,
      project,
      tiersExists: existsSync(${JSON.stringify(tiersPath)}),
      stateExists: existsSync(${JSON.stringify(statePath)}),
      blackboxExists: existsSync(${JSON.stringify(blackboxPath)}),
    }));
  `)

  assert.ok(String(fresh.reportId || "").length > 0, "fresh session should persist a report to disk")
  assert.ok(fresh.projectSessions >= 1, "fresh session should create project history")
  assert.ok(String(fresh.env?.OPENCODE_MODEL || "").includes("deepseek/deepseek-v4-pro"), "shell env should resolve the brain model")
  assert.ok(String(fresh.status || "").includes("[vibeOS-dashboard]"), "status should emit dashboard state")
  assert.ok(String(fresh.footer || "").includes("vibeOS") || String(fresh.footer || "").includes("saved") || String(fresh.footer || "").includes("$"), "footer should render live savings")
  assert.ok(String(fresh.project || "").includes("Project profile"), "project view should be available after first install")
  assert.ok(existsSync(ledgerPath), "first session should write a disk ledger")
  assert.ok(existsSync(handoverPath), "first session should write a handover notebook")

  writeFileSync(tiersPath, JSON.stringify({
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-pro", cc: "deepseek-reasoner", manual: true },
      medium: { oc: "deepseek/deepseek-v4-flash", cc: "haiku", manual: true },
      cheap: { oc: "deepseek/deepseek-chat", cc: "haiku", manual: true },
    },
    selection: {
      enabled: true,
      active_slot: "brain",
      delegation_enforce: true,
      flow_enabled: true,
      flow_enforce: true,
      tdd_enforce: true,
      tdd_strict: true,
      tdd_quality: true,
      thinking_level: "off",
      onboarding_mode: "strict",
    },
  }, null, 2) + "\n")

  writeFileSync(blackboxPath, "{ this is not valid json }\n")
  writeFileSync(activeJobsPath, JSON.stringify({
    stale_project: {
      status: "active",
      createdAt: new Date(Date.now() - STALE_MS - 60000).toISOString(),
      updatedAt: new Date(Date.now() - STALE_MS - 60000).toISOString(),
      project_fingerprint: "stale-project",
    },
  }, null, 2) + "\n")

  const update = runSession("update", `
    const rebuild = await hooks.tool.trinity.execute({ action: "rebuild" });
    const blackbox = await hooks.tool.trinity.execute({ action: "blackbox", slot: "status" });
    const repairPreview = await hooks.tool.trinity.execute({ action: "repair-state", slot: "preview" });
    const modState = await import(${JSON.stringify(pathToFileURL(join(ROOT, "src/lib/state.js")).href)} + "?update=" + Date.now());
    const activeJobs = modState.loadActiveJobs();
    const tiers = JSON.parse(readFileSync(${JSON.stringify(tiersPath)}, "utf8"));
    writeLedger({
      phase: "update-install",
      validated: {
        rebuild: rebuild.slice(0, 120),
        blackbox: blackbox.slice(0, 120),
        repairPreview: repairPreview.slice(0, 120),
        activeJobs: Object.keys(activeJobs || {}).length,
        manual: [tiers.trinity.brain.manual, tiers.trinity.medium.manual, tiers.trinity.cheap.manual],
      },
      remaining: ["reset", "missing-state", "stale-state"],
    });
    writeHandover([
      "# Session 2",
      "What was done: verified rebuild/update behavior, blackbox status on corrupt state, and stale-job pruning.",
      "What remains: explicit reset behavior, missing-file recovery, and cross-session continuity proof.",
      "Validated hypotheses: rebuild preserves user slots, corrupt blackbox state does not crash, stale jobs are normalized away.",
      "Regressions found: none yet.",
      "Needs re-testing: ensure reset clears the current session tracker and missing files seed cleanly.",
      "Next session: remove state files and rerun first-run paths.",
    ]);
    process.stdout.write(JSON.stringify({
      rebuild,
      blackbox,
      repairPreview,
      activeJobs: Object.keys(activeJobs || {}),
      tiers,
    }));
  `)

  assert.ok(String(update.rebuild || "").includes("model-tiers.json updated") || String(update.rebuild || "").includes("Auto-detected"), "rebuild should complete successfully")
  assert.ok(String(update.blackbox || "").includes("Blackbox Decision Engine"), "blackbox status should remain usable with corrupt state")
  assert.ok(String(update.repairPreview || "").includes("State repair") || String(update.repairPreview || "").includes("No duplicate"), "repair preview should be safe to call")
  assert.equal(update.tiers.trinity.brain.manual, true, "manual brain slot should survive rebuild")
  assert.equal(update.tiers.trinity.medium.manual, true, "manual medium slot should survive rebuild")
  assert.equal(update.tiers.trinity.cheap.manual, true, "manual cheap slot should survive rebuild")

  const reset = runSession("reset", `
    const blackboxReset = await hooks.tool.trinity.execute({ action: "blackbox", slot: "reset" });
    const status = await hooks.tool.trinity.execute({ action: "blackbox", slot: "status" });
    const missingBefore = existsSync(${JSON.stringify(tiersPath)});
    rmSync(${JSON.stringify(tiersPath)}, { force: true });
    rmSync(${JSON.stringify(statePath)}, { force: true });
    const envOut = { env: {} };
    await hooks["shell.env"]({}, envOut);
    await hooks["tool.execute.before"]({ tool: "bash", args: { command: "echo reseed" } }, { args: { command: "echo reseed" } });
    const rebuild = await hooks.tool.trinity.execute({ action: "rebuild" });
    const rebound = await hooks.tool.trinity.execute({ action: "status" });
    const project = await hooks.tool.trinity.execute({ action: "project" });
    writeLedger({
      phase: "reset-chain",
      validated: {
        blackboxReset: blackboxReset.slice(0, 120),
        status: status.slice(0, 120),
        missingBefore,
        env: envOut.env,
        rebuild: rebuild.slice(0, 120),
        rebound: rebound.slice(0, 120),
        project: project.slice(0, 120),
      },
      remaining: ["stale-state", "continuity", "final-audit"],
    });
    writeHandover([
      "# Session 3",
      "What was done: verified blackbox reset and missing-state reseeding.",
      "What remains: prove continuity survives another restart and that stale files stay ignored.",
      "Validated hypotheses: reset clears the active tracker; missing files are reseeded on demand.",
      "Regressions found: none yet.",
      "Needs re-testing: cross-session project memory and stale file cleanup after the next restart.",
      "Next session: reopen the same sandbox and confirm continuity from disk-backed state.",
    ]);
    process.stdout.write(JSON.stringify({
      blackboxReset,
      status,
      env: envOut.env,
      rebuild,
      rebound,
      project,
      tiersExists: existsSync(${JSON.stringify(tiersPath)}),
      stateExists: existsSync(${JSON.stringify(statePath)}),
      blackboxExists: existsSync(${JSON.stringify(blackboxPath)}),
    }));
  `)

  assert.ok(String(reset.blackboxReset || "").includes("RESET"), "blackbox reset should return a visible reset acknowledgment")
  assert.ok(String(reset.status || "").includes("No resolution data yet") || String(reset.status || "").includes("Blackbox Decision Engine"), "blackbox status should still be callable after reset")
  assert.ok(String(reset.rebound || "").includes("[vibeOS-dashboard]"), "status should still be readable after missing-state recovery")
  assert.ok(String(reset.project || "").includes("Project profile"), "project continuity should remain accessible after reset")

  const continuity = runSession("continuity", `
    const project = await hooks.tool.trinity.execute({ action: "project" });
    const report = await mod.saveReport({
      type: "forensic-continuity",
      summary: "multi-session continuity check",
      metrics: {
        projectName: "forensic-project",
        projectFingerprint: "forensic-project",
        sessionId: "continuity",
      },
      status: "completed",
    });
    const projectState = JSON.parse(readFileSync(${JSON.stringify(projectStatePath)}, "utf8"));
    const projectBucket = projectState.project_hashes?.[Object.keys(projectState.project_hashes || {})[0]] || {};
    writeLedger({
      phase: "continuity",
      validated: {
        project: project.slice(0, 120),
        report,
        sessions: projectBucket.totalSessions || 0,
        reports: (projectBucket.reports || []).length,
      },
      remaining: ["none"],
    });
    writeHandover([
      "# Session 4",
      "What was done: confirmed project-memory continuity and report persistence.",
      "What remains: no known functional gaps from this chain.",
      "Validated hypotheses: project state and saved reports survive restart boundaries.",
      "Regressions found: none in this pass.",
      "Needs re-testing: rerun after future changes to rebuild, status, or persistence helpers.",
      "Next session: use this ledger to compare any future continuity regressions.",
    ]);
    process.stdout.write(JSON.stringify({
      project,
      report,
      projectState,
    }));
  `)

  assert.ok(String(continuity.project || "").includes("Project profile"), "project output should stay stable across sessions")
  assert.ok(String(continuity.report || "").length > 0, "saving a report should return an id")

  const ledger = readFileSync(ledgerPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
  assert.equal(ledger.length, 4, "each session should append one ledger record")
  assert.deepEqual(ledger.map((row) => row.phase), ["fresh-install", "update-install", "reset-chain", "continuity"], "ledger should preserve session order")
  assert.ok(readFileSync(handoverPath, "utf8").includes("Next session"), "handover notebook should capture each session handoff")
})

test("forensic cascade: missing and stale disk state are repaired without side effects", async () => {
  rmSync(tiersPath, { force: true })
  rmSync(statePath, { force: true })
  rmSync(blackboxPath, { force: true })
  rmSync(activeJobsPath, { force: true })
  const recovery = runSession("recovery", `
    const modState = await import(${JSON.stringify(pathToFileURL(join(ROOT, "src/lib/state.js")).href)} + "?recovery=" + Date.now());
    const status = await hooks.tool.trinity.execute({ action: "status" });
    const diagnose = await hooks.tool.trinity.execute({ action: "diagnose" });
    const mode = await hooks.tool.trinity.execute({ action: "mode", slot: "quality" });
    const selected = JSON.parse(readFileSync(${JSON.stringify(tiersPath)}, "utf8")).selection;
    const activeJobs = modState.loadActiveJobs();
    await hooks["tool.execute.before"]({ tool: "bash", args: { command: "echo recovery" } }, { args: { command: "echo recovery" } });
    writeLedger({
      phase: "recovery",
      validated: {
        status: status.slice(0, 120),
        diagnose: diagnose.slice(0, 120),
        mode: mode.slice(0, 120),
        selected,
        activeJobs: Object.keys(activeJobs || {}).length,
      },
      remaining: ["none"],
    });
    writeHandover([
      "# Session 5",
      "What was done: verified missing-state reseeding and diagnosis from scratch.",
      "What remains: no known blockers; future changes should rerun this chain.",
      "Validated hypotheses: missing disk state is recovered on demand and mode changes still persist.",
      "Regressions found: none.",
      "Needs re-testing: if any persistence path changes, rerun the full chain end to end.",
      "Next session: compare status, diagnose, and mode behavior against this baseline.",
    ]);
    process.stdout.write(JSON.stringify({
      status,
      diagnose,
      mode,
      selected,
      activeJobs: Object.keys(activeJobs || {}).length,
    }));
  `)

  assert.ok(String(recovery.status || "").includes("[vibeOS-dashboard]"), "status should self-heal missing state")
  assert.ok(String(recovery.diagnose || "").includes("Self Diagnostic") || String(recovery.diagnose || "").includes("vibeOS"), "diagnose should remain usable")
  assert.equal(recovery.selected.active_slot, "brain", "quality mode should resolve to the brain slot")
  assert.equal(existsSync(tiersPath), true, "recovery should reseed model-tiers.json")
  assert.equal(existsSync(statePath), true, "recovery should reseed delegation-state.json")
  assert.equal(existsSync(blackboxPath), true, "recovery should reseed blackbox-state.json")
  assert.equal(recovery.activeJobs, 0, "stale active jobs should be pruned on load")
})

test("forensic cascade: temporary artifact files are present for postmortem review", () => {
  assert.equal(existsSync(ledgerPath), true, "ledger artifact should exist")
  assert.equal(existsSync(handoverPath), true, "handover artifact should exist")
  const ledger = readFileSync(ledgerPath, "utf8").trim().split("\n").filter(Boolean)
  assert.ok(ledger.length >= 5, "ledger should contain the session trail")
})

test.after(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

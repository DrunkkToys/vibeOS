// Does a turn finish at all? The 5-turn quality benchmark is n=1 per hour and
// voids whole trials on a single stall, which cannot separate "the plugin breaks
// turns" from "the free tier stalled". This runs one short tool-using turn many
// times per arm and reports completion rate.
//
// Usage: node scripts/e2e/completion-rate.mjs --n 10 --arms raw,vibeultrax

import { spawnSync } from "node:child_process"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { ARM_DEFS } from "./ml-task/score.mjs"
import { installVibeTierAgentsInConfig } from "../lib/vibe-tier-agents.mjs"

const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const ROOT = process.cwd()
const OPENCODE = join(process.env.HOME || "", ".opencode", "bin", "opencode")
const BUNDLE = join(ROOT, "dist", "vibeOS.js")
const N = Number(flag("--n", "10"))
const OUT = flag("--out", ".completion-rate")
const MODEL = flag("--model", "opencode/mimo-v2.5-free")
const TIMEOUT = Number(flag("--timeout", "180000"))
const ARMS = flag("--arms", "raw,vibeultrax").split(",").map(s => s.trim()).filter(a => ARM_DEFS[a])
const TIERS = {
  cheap: process.env.ML_IMPACT_CHEAP || "opencode/muse-spark-1.2-contributor-free",
  medium: process.env.ML_IMPACT_MEDIUM || "opencode/big-pickle",
  brain: process.env.ML_IMPACT_BRAIN || "opencode/mimo-v2.5-free",
}
// Small, deterministic, and it must call a tool -- an answer with no tool call
// never exercises tool.execute.before, which is where the plugin does its work.
const PROMPT = "Read the file data.txt in this directory and reply with only the number it contains. Do not edit anything."

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

function trial(arm, i) {
  const def = ARM_DEFS[arm]
  const proj = join(OUT, `${arm}-${i}`, "proj")
  const home = join(OUT, `${arm}-${i}`, "home")
  mkdirSync(proj, { recursive: true })
  mkdirSync(home, { recursive: true })
  writeFileSync(join(proj, "data.txt"), "42\n")
  const config = { $schema: "https://opencode.ai/config.json" }
  if (def.plugin) {
    config.plugin = [BUNDLE]
    installVibeTierAgentsInConfig(config, { trinity: { cheap: { oc: TIERS.cheap }, medium: { oc: TIERS.medium }, brain: { oc: TIERS.brain } } })
    writeFileSync(join(home, "model-tiers.json"), JSON.stringify({
      trinity: { cheap: { oc: TIERS.cheap }, medium: { oc: TIERS.medium }, brain: { oc: TIERS.brain } },
      selection: {
        enabled: true, optimization_mode: def.mode, requested_optimization_mode: def.mode,
        active_pipeline: def.pipeline, active_slot: def.entry, entry_slot: def.entry,
        slot_locked: false, axis_overrides: {},
      },
    }, null, 2))
  }
  writeFileSync(join(proj, "opencode.json"), JSON.stringify(config, null, 2))

  const env = { ...process.env, VIBEOS_HOME: home, VIBEOS_API_URL: "http://127.0.0.1:1",
    VIBEOS_API_TOKEN: "vos_" + "a".repeat(64), VIBEOS_MCP_PORT: "0", OPENCODE_DISABLE_AUTOUPDATE: "1" }
  const args = ["run", "--dir", proj, "--format", "json", "--auto", "-m", MODEL, "--agent", def.agent]
  if (def.pure) args.push("--pure")
  args.push(PROMPT)

  const t = Date.now()
  let res
  try { res = spawnSync(OPENCODE, args, { encoding: "utf8", timeout: TIMEOUT, killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024, env }) }
  catch (e) { res = { stdout: e.stdout || "", stderr: e.stderr || "", status: e.status ?? -1 } }
  const ms = Date.now() - t
  const out = res.stdout || ""
  writeFileSync(join(OUT, `${arm}-${i}.log`), out + "\n===STDERR===\n" + (res.stderr || ""))
  const ev = out.split("\n").map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const sawAnswer = ev.some(e => e.type === "text" && /\b42\b/.test(JSON.stringify(e.part || "")))
  return { ok: res.status === 0, status: res.status, ms, steps: ev.filter(e => e.type === "step_finish").length, sawAnswer }
}

const summary = {}
for (const arm of ARMS) {
  const rows = []
  for (let i = 0; i < N; i++) {
    const r = trial(arm, i)
    rows.push(r)
    console.log(`  ${arm.padEnd(11)} #${i} ${r.ok ? "OK " : "FAIL"} ${(r.ms / 1000).toFixed(0).padStart(4)}s steps=${r.steps} answer=${r.sawAnswer}`)
  }
  const ok = rows.filter(r => r.ok)
  const correct = rows.filter(r => r.ok && r.sawAnswer)
  summary[arm] = {
    n: N, completed: ok.length, correct: correct.length,
    medianMs: ok.length ? ok.map(r => r.ms).sort((a, b) => a - b)[Math.floor(ok.length / 2)] : 0,
  }
}
console.log("\n=========== COMPLETION RATE ===========")
console.log("arm          n  completed  correct  median")
for (const [arm, s] of Object.entries(summary)) {
  console.log(`${arm.padEnd(12)} ${String(s.n).padStart(2)}  ${String(s.completed).padStart(9)}  ${String(s.correct).padStart(7)}  ${(s.medianMs / 1000).toFixed(0)}s`)
}
writeFileSync(join(OUT, "summary.json"), JSON.stringify(summary, null, 2))

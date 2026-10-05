// SPDX-License-Identifier: MIT
import { execFileSync, spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

export function loadPolyglot(root) {
  const base = join(root, "python", "exercises", "practice")
  return readdirSync(base).sort().filter((name) => existsSync(join(base, name, ".meta", "config.json"))).map((name) => {
    const dir = join(base, name)
    const cfg = JSON.parse(readFileSync(join(dir, ".meta", "config.json"), "utf8"))
    return { task_id: `python/${name}`, name, dir, solution: cfg.files.solution, tests: cfg.files.test }
  })
}

function visibleFiles(dir) {
  return readdirSync(dir).filter((f) => !f.startsWith(".") && statSync(join(dir, f)).isFile())
}

export function writeExercise(proj, ex) {
  for (const f of visibleFiles(ex.dir)) copyFileSync(join(ex.dir, f), join(proj, f))
  const docs = ["instructions.md", "instructions.append.md"]
    .map((f) => join(ex.dir, ".docs", f))
    .filter(existsSync)
    .map((p) => readFileSync(p, "utf8").trim())
  writeFileSync(join(proj, "INSTRUCTIONS.md"), docs.join("\n\n") + "\n")
}

function testModules(ex) {
  return ex.tests.map((f) => f.replace(/\.py$/, "")).join(" ")
}

export function turnsForExercise(ex) {
  const cmd = `python3 -m unittest ${testModules(ex)}`
  return [
    { id: "implement", prompt: `Read INSTRUCTIONS.md and implement ${ex.solution.join(", ")} so the tests pass. Do not modify the test files. Run the tests with \`${cmd}\` and fix any failures.` },
    { id: "fix", prompt: `Run the tests with \`${cmd}\` and fix any failures. Do not modify the test files.` },
  ]
}

let _python = null
function python() {
  if (!_python) {
    _python = execFileSync("uv", ["run", "--no-project", "python", "-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).trim()
  }
  return _python
}

export function gradeExercise(proj, ex, { timeoutMs = 60000 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "polyglot-grade-"))
  try {
    for (const f of visibleFiles(ex.dir)) {
      if (!ex.solution.includes(f)) copyFileSync(join(ex.dir, f), join(dir, f))
    }
    for (const f of ex.solution) {
      const src = join(proj, f)
      if (existsSync(src)) copyFileSync(src, join(dir, f))
    }
    const r = spawnSync(python(), ["-m", "unittest", ...ex.tests.map((f) => f.replace(/\.py$/, ""))], { cwd: dir, timeout: timeoutMs, killSignal: "SIGKILL", encoding: "utf8" })
    return { pass: r.status === 0, status: r.status, error: (r.stderr || "").slice(-400) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

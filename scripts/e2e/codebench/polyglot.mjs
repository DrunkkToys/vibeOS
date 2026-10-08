// SPDX-License-Identifier: MIT
import { spawnSync } from "node:child_process"
import { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { python } from "./python.mjs"

const SKIP = { cpp: ["gigasecond", "meetup"] }

export function loadPolyglot(root, { language = "python" } = {}) {
  const base = join(root, language, "exercises", "practice")
  const skip = SKIP[language] || []
  return readdirSync(base).sort().filter((name) => !skip.includes(name) && existsSync(join(base, name, ".meta", "config.json"))).map((name) => {
    const dir = join(base, name)
    const cfg = JSON.parse(readFileSync(join(dir, ".meta", "config.json"), "utf8"))
    return { task_id: `${language}/${name}`, language, name, dir, solution: cfg.files.solution, tests: cfg.files.test }
  })
}

function visibleFiles(dir) {
  return readdirSync(dir).filter((f) => !f.startsWith(".") && statSync(join(dir, f)).isFile())
}

function visibleDirs(dir) {
  return readdirSync(dir).filter((f) => !f.startsWith(".") && statSync(join(dir, f)).isDirectory())
}

const CPP_TEST_CMD = "cmake -DEXERCISM_RUN_ALL_TESTS=1 -S . -B build && cmake --build build"

function copyPristine(ex, dest) {
  for (const f of visibleFiles(ex.dir)) {
    if (!ex.solution.includes(f)) copyFileSync(join(ex.dir, f), join(dest, f))
  }
  for (const d of visibleDirs(ex.dir)) cpSync(join(ex.dir, d), join(dest, d), { recursive: true })
  if (ex.language === "cpp") {
    const cmake = join(dest, "CMakeLists.txt")
    const pinned = readFileSync(cmake, "utf8").replace(/^get_filename_component\(exercise \$\{CMAKE_CURRENT_SOURCE_DIR\} NAME\)$/m, `set(exercise ${ex.name})`)
    writeFileSync(cmake, pinned)
  }
}

export function writeExercise(proj, ex) {
  copyPristine(ex, proj)
  for (const f of ex.solution) {
    if (existsSync(join(ex.dir, f))) copyFileSync(join(ex.dir, f), join(proj, f))
  }
  if (ex.language === "cpp") writeFileSync(join(proj, "Makefile"), `.PHONY: test\ntest:\n\t${CPP_TEST_CMD}\n`)
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
  const cmd = ex.language === "cpp" ? "make test" : `python3 -m unittest ${testModules(ex)}`
  return [
    { id: "implement", prompt: `Read INSTRUCTIONS.md and implement ${ex.solution.join(", ")} so the tests pass. Do not modify the test files. Run the tests with \`${cmd}\` and fix any failures.` },
    { id: "fix", prompt: `Run the tests with \`${cmd}\` and fix any failures. Do not modify the test files.` },
  ]
}

export function gradeExercise(proj, ex, { timeoutMs = ex.language === "cpp" ? 180000 : 60000 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "polyglot-grade-"))
  try {
    copyPristine(ex, dir)
    for (const f of ex.solution) {
      const src = join(proj, f)
      if (existsSync(src)) copyFileSync(src, join(dir, f))
    }
    const r = ex.language === "cpp"
      ? spawnSync("sh", ["-c", CPP_TEST_CMD], { cwd: dir, timeout: timeoutMs, killSignal: "SIGKILL", encoding: "utf8" })
      : spawnSync(python(), ["-m", "unittest", ...ex.tests.map((f) => f.replace(/\.py$/, ""))], { cwd: dir, timeout: timeoutMs, killSignal: "SIGKILL", encoding: "utf8" })
    return { pass: r.status === 0, status: r.status, error: ((r.stderr || "") + (r.stdout || "")).slice(-400) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

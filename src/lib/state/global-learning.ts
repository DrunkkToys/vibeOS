// @ts-nocheck
// Cross-project pattern-learning state (global-learning.json). Split out of
// state.ts (Phase D file-size cleanup). Computes its path fresh via
// getVibeOSHome() on every call rather than importing a snapshotted `let`
// from state.ts — see src/lib/state/scratchpad-cache.ts for why that matters.
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, renameSync } from "node:fs"
import { join, dirname } from "node:path"
import { safeJsonParse } from "../../utils/fs-helpers.js"
import { getVibeOSHome } from "../runtime-paths.js"
import { DFLT_GL, _handleStateCorruption, withFileLock } from "../state.js"

export function loadGlobalLearning(): unknown {
  const globalLearningFile = join(getVibeOSHome(), "global-learning.json")
  try {
    if (!existsSync(globalLearningFile)) return DFLT_GL
    const st = statSync(globalLearningFile)
    if (st.size > 10485760) { _handleStateCorruption(globalLearningFile); return DFLT_GL }
    const j = safeJsonParse(readFileSync(globalLearningFile, "utf-8"))
    if (!j || typeof j !== "object") return DFLT_GL
    j.exploratory_words ??= {}
    j.task_first_words ??= {}
    j.context7_bypasses ??= 0
    j.context7_missed_usd ??= 0
    j.context7_last_seen ??= null
    return j
  } catch {
    _handleStateCorruption(globalLearningFile)
    return DFLT_GL
  }
}

export function updateGlobalLearning(mutator: (gl: unknown) => unknown): unknown {
  const globalLearningFile = join(getVibeOSHome(), "global-learning.json")
  return withFileLock(globalLearningFile, () => {
    const s = loadGlobalLearning()
    const next = mutator(s) ?? s
    next.updatedAt = new Date().toISOString()
    mkdirSync(dirname(globalLearningFile), { recursive: true })
    const tmp = globalLearningFile + ".tmp"
    writeFileSync(tmp, JSON.stringify(next, null, 2))
    renameSync(tmp, globalLearningFile)
    return next
  })
}

export function getLearnedExploratoryWords(): Set<string> {
  const out = new Set<string>()
  try {
    const gl = loadGlobalLearning()
    for (const [w, meta] of Object.entries(gl.exploratory_words || {})) {
      if ((meta as unknown)?.count >= 1) out.add(String(w))
    }
  } catch {}
  return out
}

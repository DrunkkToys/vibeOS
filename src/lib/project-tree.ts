// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
//
// Persistent project knowledge tree.
//
// A durable, hierarchical memory per project that survives across sessions:
//
//   project (fingerprint)
//     └─ branch (topic / file / area)
//          └─ leaf facts: { kind: fact|decision|blocker, text, at }
//
// Unlike the scratchpad (ephemeral, hash-addressed tool output) this is long-lived
// structured knowledge — decisions made, blockers hit, facts learned — that gets
// condensed into a single system-prompt directive each turn so the assistant keeps
// project context without re-deriving it. Storage reuses the same file-lock + JSON
// helpers as the rest of vibeOS state; it does not invent a new persistence layer.

import { readFileSync, writeFileSync, existsSync, renameSync, statSync } from "node:fs"
import { join } from "node:path"
import { withFileLock, getVibeOSHome, safeJsonParse } from "./state.js"

// ── Caps (mirror the scratchpad's bounded-growth philosophy) ─────────
const MAX_BRANCHES_PER_PROJECT = 24
const MAX_FACTS_PER_BRANCH = 12
const MAX_FACT_LEN = 280
const MAX_TREE_BYTES = 2 * 1024 * 1024

export type FactKind = "fact" | "decision" | "blocker"
export interface TreeFact { kind: FactKind; text: string; at: number }
export interface TreeBranch { label: string; updated_at: number; facts: TreeFact[] }
export interface ProjectTree { name: string; updated_at: number; branches: Record<string, TreeBranch> }

function treeFilePath(): string {
  return join(getVibeOSHome(), "project-tree.json")
}

function branchKey(branch: string): string {
  return String(branch || "general").trim().toLowerCase().replace(/\s+/g, "-").slice(0, 48) || "general"
}

function readTreeFile(): { projects: Record<string, ProjectTree> } {
  const f = treeFilePath()
  try {
    if (!existsSync(f)) return { projects: {} }
    const st = statSync(f)
    if (st.size > MAX_TREE_BYTES) {
      // Oversized → reset rather than fight a corrupt/runaway file.
      return { projects: {} }
    }
    const j = safeJsonParse(readFileSync(f, "utf-8")) as { projects?: Record<string, ProjectTree> } | null
    return j && typeof j === "object" && j.projects ? { projects: j.projects } : { projects: {} }
  } catch {
    return { projects: {} }
  }
}

/**
 * Record a fact/decision/blocker for a project under a topic branch.
 * Append-only with per-branch and per-project pruning (oldest dropped first).
 * Returns false on empty input or write failure.
 */
export function recordProjectFact(
  fp: string,
  projectName: string,
  branch: string,
  kind: FactKind,
  text: string,
): boolean {
  const cleanText = String(text || "").trim().slice(0, MAX_FACT_LEN)
  if (!fp || !cleanText) return false
  const key = branchKey(branch)
  const f = treeFilePath()
  try {
    return withFileLock(f, () => {
      const j = readTreeFile()
      j.projects ??= {}
      const proj: ProjectTree = j.projects[fp] || { name: projectName || "unknown", updated_at: 0, branches: {} }
      proj.name = projectName || proj.name || "unknown"
      proj.branches ??= {}
      const br: TreeBranch = proj.branches[key] || { label: String(branch || "general"), updated_at: 0, facts: [] }
      // De-dupe identical recent text within the branch.
      if (!br.facts.some((x) => x.text === cleanText && x.kind === kind)) {
        br.facts.push({ kind, text: cleanText, at: Date.now() })
        if (br.facts.length > MAX_FACTS_PER_BRANCH) br.facts = br.facts.slice(-MAX_FACTS_PER_BRANCH)
      }
      br.updated_at = Date.now()
      proj.branches[key] = br
      // Prune branches by recency if over cap.
      const keys = Object.keys(proj.branches)
      if (keys.length > MAX_BRANCHES_PER_PROJECT) {
        keys
          .sort((a, b) => (proj.branches[b].updated_at || 0) - (proj.branches[a].updated_at || 0))
          .slice(MAX_BRANCHES_PER_PROJECT)
          .forEach((k) => delete proj.branches[k])
      }
      proj.updated_at = Date.now()
      j.projects[fp] = proj
      const tmp = f + ".tmp." + Date.now()
      writeFileSync(tmp, JSON.stringify(j, null, 2) + "\n")
      renameSync(tmp, f)
      return true
    })
  } catch (err) {
    console.error("[vibeOS] recordProjectFact failed:", err instanceof Error ? err.message : err)
    return false
  }
}

/** Load the full knowledge tree for one project (null when none). */
export function loadProjectTree(fp: string): ProjectTree | null {
  if (!fp) return null
  const j = readTreeFile()
  return j?.projects?.[fp] || null
}

/**
 * Condensed one-line-per-branch directive for the system prompt. Returns null when the
 * project has no recorded knowledge yet. Keeps the most recently updated branches and the
 * most recent facts within each, so the hot context stays small.
 */
export function projectTreeDirective(fp: string, opts: { maxBranches?: number; maxFactsPerBranch?: number } = {}): string | null {
  const proj = loadProjectTree(fp)
  if (!proj || !proj.branches) return null
  const maxBranches = opts.maxBranches ?? 5
  const maxFacts = opts.maxFactsPerBranch ?? 3
  const branches = Object.values(proj.branches)
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
    .slice(0, maxBranches)
  if (branches.length === 0) return null
  const glyph: Record<FactKind, string> = { fact: "•", decision: "→", blocker: "⚠" }
  const lines = branches.map((br) => {
    const facts = [...br.facts]
      .sort((a, b) => (b.at || 0) - (a.at || 0))
      .slice(0, maxFacts)
      .map((x) => `${glyph[x.kind] || "•"} ${x.text}`)
      .join("; ")
    return `${br.label}: ${facts}`
  })
  return `[project knowledge: ${proj.name || "project"}] ` + lines.join(" | ")
}

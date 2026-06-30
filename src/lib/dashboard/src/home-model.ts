import type { OrchFlow, OrchProject, OrchSession } from "./api.js"

export const DEFAULT_SELECTION_KIND = "home"

export type ProjectIcon = {
  glyph: string
  label: string
}

export function inferProjectIcon(project: Pick<OrchProject, "name" | "fingerprint"> | null | undefined): ProjectIcon {
  const name = String(project?.name || "").trim()
  const fingerprint = String(project?.fingerprint || "").trim()
  const source = `${name} ${fingerprint}`.toLowerCase()

  if (/\b(cli|terminal|shell|console)\b/.test(source)) return { glyph: "⌘", label: "CLI" }
  if (/\b(api|backend|server)\b/.test(source)) return { glyph: "◫", label: "API" }
  if (/\b(web|site|frontend|dashboard|ui|home)\b/.test(source)) return { glyph: "◩", label: "UI" }
  if (/\b(app|desktop|mobile)\b/.test(source)) return { glyph: "▣", label: "App" }

  const initials = name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("")
  if (initials) return { glyph: initials, label: name || initials }

  const seed = fingerprint || name || "project"
  const glyphs = ["◆", "◈", "◉", "▣", "⬢", "◬"]
  let hash = 0
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return { glyph: glyphs[hash % glyphs.length], label: name || "Project" }
}

export function resolveFlowSummary(input: {
  session: Pick<OrchSession, "flow_id" | "project_id"> | null | undefined
  project: Pick<OrchProject, "default_flow_id"> | null | undefined
  flows: Pick<OrchFlow, "id" | "name" | "scope" | "project_id">[]
}): string {
  const flows = Array.isArray(input.flows) ? input.flows : []
  const sessionFlow = input.session?.flow_id
    ? flows.find((flow) => flow.id === input.session?.flow_id) || null
    : null
  if (sessionFlow) return `${sessionFlow.name}${sessionFlow.scope === "project" ? " (session override)" : " (global)"}`.trim()

  const projectFlow = input.project?.default_flow_id
    ? flows.find((flow) => flow.id === input.project?.default_flow_id) || null
    : null
  if (projectFlow) return `${projectFlow.name}${projectFlow.scope === "project" ? " (project default)" : " (global default)"}`.trim()

  const globalFlow = flows.find((flow) => flow.scope === "global")
  if (globalFlow) return `${globalFlow.name} (global default)`

  return "No default flow"
}

export function activeContextLabel(input: {
  currentProjectName?: string | null
  currentSessionId?: string | null
}): string {
  const project = String(input.currentProjectName || "").trim() || "unknown project"
  const session = String(input.currentSessionId || "").trim()
  return session ? `${project} · ${session}` : project
}

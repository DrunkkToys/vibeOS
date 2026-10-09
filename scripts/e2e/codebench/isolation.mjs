// SPDX-License-Identifier: MIT
export const ISOLATION_PERMISSION = { webfetch: "deny", websearch: "deny", codesearch: "deny", external_directory: "deny" }

const WEB_TOOLS = new Set(["webfetch", "websearch", "codesearch"])
const ABS_PATH = /(?:^|[\s"'=:(<>|;&`])(\/[A-Za-z][\w.-]*\/[\w.\-/]*|\/[A-Za-z][\w.-]*(?=$|[\s"';&|)]))/g
const HOME_REF = /(?:^|[\s"'=:(<>|;&`])(~|\$HOME|\$\{HOME\})(\/[\w.\-/]*)?(?=$|[\s"';&|)])/g
const DISK_SEARCH = /\b(?:find|grep|rg|fd|ls|du)\b[^;|&\n]*\s\/(?=$|[\s;|&])/
const INDEX_SEARCH = /\b(?:mdfind|locate)\b/

function norm(p) {
  return p.replace(/^\/System\/Volumes\/Data(?=\/)/, "").replace(/^\/private(?=\/(?:var|tmp)\/)/, "").replace(/\/+$/, "") || "/"
}

function inside(path, root) {
  return path === root || path.startsWith(root + "/")
}

export function leakedAccess(text, { proj, sensitive = [], testFiles = [], home = "" }) {
  const projRoot = norm(proj)
  const roots = sensitive.map(norm)
  const homeRoot = home ? norm(home) : ""
  const verdict = (p) => {
    const n = norm(p)
    if (inside(n, projRoot)) return null
    if (roots.some((r) => inside(n, r))) return "sensitive"
    if (/\/polyglot-grade-/.test(n)) return "grader"
    if (testFiles.some((f) => n.endsWith("/" + f))) return "test file"
    if (homeRoot && n === homeRoot) return "home search"
    return null
  }
  const leaks = []
  for (const line of String(text).split("\n")) {
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    const part = ev?.part
    if (ev?.type !== "tool_use" || part?.type !== "tool" || part.state?.status !== "completed") continue
    const input = part.state.input || {}
    if (WEB_TOOLS.has(part.tool)) { leaks.push(`${part.tool} ${input.url || input.query || ""}`.trim()); continue }
    const paths = []
    if (part.tool === "bash") {
      const cmd = String(input.command || "")
      if (INDEX_SEARCH.test(cmd) || DISK_SEARCH.test(cmd)) { leaks.push(`bash disk search: ${cmd.slice(0, 80)}`); continue }
      for (const m of cmd.matchAll(ABS_PATH)) paths.push(m[1])
      for (const m of cmd.matchAll(HOME_REF)) paths.push(homeRoot ? homeRoot + (m[2] || "") : "~")
    } else {
      for (const key of ["filePath", "path"]) if (typeof input[key] === "string" && input[key].startsWith("/")) paths.push(input[key])
    }
    for (const p of paths) {
      const why = p === "~" ? "home search" : verdict(p)
      if (why) { leaks.push(`${part.tool} ${why}: ${p}`); break }
    }
  }
  return leaks
}

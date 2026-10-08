// SPDX-License-Identifier: MIT
export const ISOLATION_PERMISSION = { webfetch: "deny", websearch: "deny", codesearch: "deny", external_directory: "deny" }

const WEB_TOOLS = new Set(["webfetch", "websearch", "codesearch"])
const SYSTEM = ["/usr/", "/bin/", "/sbin/", "/opt/", "/dev/", "/etc/", "/System/Library/", "/Library/"]
const ESCAPE = /(?:^|[\s"'=:(<>|;&`])(~|\$HOME|\$\{HOME\}|\.\.)(?=$|[\s/"';&|)])/
const ABS_PATH = /(?:^|[\s"'=:(<>|;&`])(\/[A-Za-z][\w.-]*\/[\w.\-/]*)/g

function inside(path, roots) {
  return roots.some((r) => path === r || path.startsWith(r.endsWith("/") ? r : r + "/"))
}

export function leakedAccess(text, proj) {
  const roots = [].concat(proj)
  const leaks = []
  for (const line of String(text).split("\n")) {
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    const part = ev?.part
    if (ev?.type !== "tool_use" || part?.type !== "tool" || part.state?.status !== "completed") continue
    const input = part.state.input || {}
    if (WEB_TOOLS.has(part.tool)) { leaks.push(`${part.tool} ${input.url || input.query || ""}`.trim()); continue }
    if (part.tool === "bash") {
      const esc = String(input.command || "").match(ESCAPE)
      if (esc) { leaks.push(`bash ${esc[1]}`); continue }
      for (const m of String(input.command || "").matchAll(ABS_PATH)) {
        const p = m[1]
        if (!inside(p, roots) && !SYSTEM.some((s) => p.startsWith(s))) { leaks.push(`bash ${p}`); break }
      }
      continue
    }
    for (const key of ["filePath", "path"]) {
      const p = input[key]
      if (typeof p === "string" && p.startsWith("/") && !inside(p, roots)) leaks.push(`${part.tool} ${p}`)
    }
  }
  return leaks
}

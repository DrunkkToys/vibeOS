import { pathToFileURL } from "node:url"

const ROOT = process.cwd()

function isTestSegment(rel) {
  return rel.startsWith("tests/") || rel.startsWith("scripts/tests/") || /^src\/(?:.+\/)?tests\//.test(rel)
}

function toRel(pathname) {
  if (!pathname.startsWith(ROOT + "/")) return null
  return pathname.slice(ROOT.length + 1)
}

function setRel(url, rel) {
  const next = new URL(url.href)
  next.pathname = `${ROOT}/${rel}`
  return next.href
}

function rewrite(url) {
  const rel = toRel(url.pathname)
  if (rel === null) return null

  if (rel.startsWith("dist-ts-tests/")) {
    const inner = rel.slice("dist-ts-tests/".length)
    if (!inner.endsWith(".js") && !inner.endsWith(".mjs")) return null
    if (isTestSegment(inner)) return null
    if (inner.startsWith("src/")) return setRel(url, "dist-ts/" + inner.slice("src/".length))
    return setRel(url, inner)
  }

  if (rel.startsWith("dist-ts/")) return null

  if (!rel.endsWith(".js")) return null

  if (rel.startsWith("src/") && !isTestSegment(rel)) return setRel(url, "dist-ts/" + rel.slice("src/".length))
  return null
}

export async function resolve(specifier, context, defaultResolve) {
  try {
    const base = context.parentURL || pathToFileURL(`${process.cwd()}/`).href
    const candidate = new URL(specifier, base)
    const rewritten = rewrite(candidate)
    if (rewritten) return { url: rewritten, shortCircuit: true }
  } catch {}
  return defaultResolve(specifier, context, defaultResolve)
}

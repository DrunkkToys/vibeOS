import { existsSync } from "node:fs"
import { statSync } from "node:fs"
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

function newerThan(sourceRel, builtRel) {
  try {
    if (!existsSync(`${ROOT}/${sourceRel}`) || !existsSync(`${ROOT}/${builtRel}`)) return false
    return statSync(`${ROOT}/${sourceRel}`).mtimeMs > statSync(`${ROOT}/${builtRel}`).mtimeMs
  } catch {
    return false
  }
}

function rewrite(url) {
  const rel = toRel(url.pathname)
  if (rel === null) return null

  if (rel.startsWith("dist-ts-tests/")) {
    const inner = rel.slice("dist-ts-tests/".length)
    if (!inner.endsWith(".js") && !inner.endsWith(".mjs")) return null
    if (isTestSegment(inner)) return null
    if (inner.startsWith("src/")) {
      const distRel = "dist-ts/" + inner.slice("src/".length)
      const tsRel = inner.replace(/\.js$/, ".ts")
      const tsxRel = inner.replace(/\.js$/, ".tsx")
      if (existsSync(`${ROOT}/${distRel}`) && !newerThan(tsRel, distRel) && !newerThan(tsxRel, distRel)) return setRel(url, distRel)
      if (existsSync(`${ROOT}/${tsRel}`)) return setRel(url, tsRel)
      if (existsSync(`${ROOT}/${tsxRel}`)) return setRel(url, tsxRel)
      return null
    }
    return setRel(url, inner)
  }

  if (rel.startsWith("dist-ts/")) return null

  if (!rel.endsWith(".js")) return null

  if (rel.startsWith("src/") && !isTestSegment(rel)) {
    const distRel = "dist-ts/" + rel.slice("src/".length)
    const tsRel = rel.replace(/\.js$/, ".ts")
    const tsxRel = rel.replace(/\.js$/, ".tsx")
    if (existsSync(`${ROOT}/${distRel}`) && !newerThan(tsRel, distRel) && !newerThan(tsxRel, distRel)) return setRel(url, distRel)
    if (existsSync(`${ROOT}/${tsRel}`)) return setRel(url, tsRel)
    if (existsSync(`${ROOT}/${tsxRel}`)) return setRel(url, tsxRel)
    return null
  }
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

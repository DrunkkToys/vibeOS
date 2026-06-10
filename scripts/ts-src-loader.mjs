import { pathToFileURL } from "node:url"

function rewriteToDistTs(url) {
  if (!url.pathname.includes("/src/") || url.pathname.includes("/tests/") || !url.pathname.endsWith(".js")) return null
  const next = new URL(url.href)
  next.pathname = url.pathname.replace("/src/", "/dist-ts/")
  return next.href
}

export async function resolve(specifier, context, defaultResolve) {
  try {
    const base = context.parentURL || pathToFileURL(`${process.cwd()}/`).href
    const candidate = new URL(specifier, base)
    const rewritten = rewriteToDistTs(candidate)
    if (rewritten) return { url: rewritten, shortCircuit: true }
  } catch {}
  return defaultResolve(specifier, context, defaultResolve)
}

import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dirname, "..")

describe("Dashboard sync path — PR eb50c01", () => {
  it("at least one known dashboard path contains index.html", () => {
    const searchPaths = [
      "src/lib/dashboard/dist",
      "dist/assets/dashboard",
      "dist/assets/dashboard/dist",
    ]
    let found = false
    for (const p of searchPaths) {
      if (existsSync(join(ROOT, p, "index.html"))) { found = true; break }
    }
    assert.ok(found, "at least one dashboard search path must contain index.html")
  })

  it("resolveDashboardDir includes new repoRoot and cwd paths", () => {
    const src = readFileSync(join(ROOT, "src/lib/vibeos-mcp-server.ts"), "utf8")
    assert.ok(
      src.includes('join(repoRoot, "src", "lib", "dashboard", "dist")'),
      "mcp-server must search repoRoot/src/lib/dashboard/dist"
    )
    assert.ok(
      src.includes('join(cwd, "src", "lib", "dashboard", "dist")'),
      "mcp-server must search cwd/src/lib/dashboard/dist"
    )
    assert.ok(
      src.includes('join(cwd, "dist-ts", "lib", "dashboard", "dist")'),
      "mcp-server must search cwd/dist-ts/lib/dashboard/dist"
    )
  })

  it("resolveDashboardDir iterates paths and returns first with index.html", () => {
    const src = readFileSync(join(ROOT, "src/lib/vibeos-mcp-server.ts"), "utf8")
    assert.ok(
      src.includes('if (existsSync(join(p, "index.html"))) return p'),
      "must return first path containing index.html"
    )
  })

  it("resolveDashboardDir falls back to first path when none found", () => {
    const src = readFileSync(join(ROOT, "src/lib/vibeos-mcp-server.ts"), "utf8")
    assert.ok(src.includes("return c[0]"), "must fallback to c[0]")
  })
})

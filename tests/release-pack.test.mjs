import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const ROOT = dirname(fileURLToPath(import.meta.url))
const releaseScript = readFileSync(join(ROOT, "..", "scripts", "release.mjs"), "utf8")

test("release script produces a local npm pack artifact", () => {
  assert.match(releaseScript, /npm pack/)
  assert.match(releaseScript, /local npm pack artifact created/)
  assert.match(releaseScript, /NODE_AUTH_TOKEN|NPM_TOKEN|npm_config_userconfig/)
})

test("release script keeps the Return codename for 0.24.x releases", () => {
  assert.match(releaseScript, /function releaseSeriesName\(version\)/)
  assert.match(releaseScript, /parts\[0\]\s*===\s*0/)
  assert.match(releaseScript, /parts\[1\]\s*===\s*24/)
  assert.match(releaseScript, /return "Return"/)
  assert.match(releaseScript, /function formatReleaseTitle\(version\)/)
  assert.match(releaseScript, /Name:\s+\$\{GREEN\}\$\{formatReleaseTitle\(newVer\)\}/)
  assert.match(releaseScript, /const releaseTitle = formatReleaseTitle\(newVer\)/)
  assert.match(releaseScript, /gh release create "v\$\{newVer\}" --title "\$\{releaseTitle\}"/)
})

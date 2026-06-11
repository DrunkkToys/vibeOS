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
})

test("release script wires npm auth from GitHub secrets when available", () => {
  assert.match(releaseScript, /NPM_TOKEN \|\| process\.env\.NODE_AUTH_TOKEN/)
  assert.match(releaseScript, /npm_config_userconfig/)
  assert.match(releaseScript, /always-auth=true/)
})

// SPDX-License-Identifier: MIT
// Contract: generated TDD skeletons must produce an import path Node's ESM loader
// can actually resolve. Live-reproduced: a skeleton generated for smart-cache.ts
// imported `from '../smart-cache'` (no extension) and crashed with
// ERR_MODULE_NOT_FOUND when run -- the "skeleton" could not even load, let alone
// provide any test value. This repo's own convention (every hand-written test under
// src/lib/hooks/tests/*.ts) always imports with an explicit `.js` extension even
// when importing from a `.ts` source file, matching how ts-src-loader.mjs rewrites
// specifiers. The skeleton generator built `importPath` with no extension at all.

import { test } from "node:test"
import assert from "node:assert/strict"

test("js/mjs/ts skeleton import paths always include a .js extension", async () => {
  const { buildTestSkeleton } = await import("../src/lib/tdd-enforcer.js")
  for (const ext of ["ts", "js", "mjs"]) {
    const skeleton = buildTestSkeleton(
      `/tmp/fake-module.${ext}`,
      "export function add(a, b) { return a + b }\n",
      { strict: true, quality: true },
    )
    assert.ok(skeleton, `skeleton should be generated for .${ext}`)
    assert.ok(
      /from ['"]\.\.\/fake-module\.js['"]|(?:require|import)\(['"]\.\.\/fake-module\.js['"]\)/.test(skeleton.content),
      `.${ext} skeleton's import path must include a resolvable .js extension:\n${skeleton.content}`
    )
  }
})

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let sandbox;
let prevHome;

const BRAND_EXPECTATIONS = {
  vibemax: "VibeMaX",
  vibeultrax: "VibeUltraX",
  vibeqmax: "VibeQMaX",
  budget: "VibeMaX",
  quality: "VibeQMaX",
  speed: "VibeMaX",
  longrun: "VibeMaX",
  auto: "VibeMaX",
};

const MODE_LOAD_EXPECTATIONS = {
  vibemax: "vibemax",
  vibeultrax: "vibeultrax",
  vibeqmax: "vibeqmax",
  budget: "budget",
  quality: "quality",
  speed: "speed",
  longrun: "longrun",
  auto: "budget",
};

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), "mode-brand-test-"));
  mkdirSync(join(sandbox, ".claude", "scratch"), { recursive: true });
  mkdirSync(join(sandbox, "my-project"), { recursive: true });

  writeFileSync(join(sandbox, ".claude", "model-tiers.json"), JSON.stringify({
    trinity: {
      brain: { oc: "deepseek/deepseek-v4-pro", cc: "deepseek-v4-pro" },
      medium: { oc: "deepseek/deepseek-v4-flash", cc: "deepseek-v4-flash" },
      cheap: { oc: "deepseek/deepseek-chat", cc: "deepseek-chat" },
    },
    selection: { enabled: true, active_slot: "medium" },
  }, null, 2));

  writeFileSync(join(sandbox, ".claude", "delegation-state.json"), JSON.stringify({
    sessions: {},
    lifetime: { total_savings_usd: 0, cache_savings_usd: 0, missed_context7_usd: 0 },
    session_started_at: new Date().toISOString(),
  }, null, 2));

  writeFileSync(join(sandbox, "my-project", "opencode.json"), JSON.stringify({
    model: "deepseek/deepseek-v4-flash",
  }, null, 2));

  prevHome = process.env.HOME;
  process.env.HOME = sandbox;
});

after(() => {
  process.env.HOME = prevHome;
  rmSync(sandbox, { recursive: true, force: true });
});

for (const modeId of Object.keys(BRAND_EXPECTATIONS)) {
  test(`mode brand: ${modeId} -> ${BRAND_EXPECTATIONS[modeId]}`, { timeout: 10000 }, async () => {
    const { getOC_SID } = await import("../src/lib/turn-classify.js?t=" + Date.now());
    const sid = getOC_SID();

    writeFileSync(join(sandbox, ".claude", "blackbox-state.json"), JSON.stringify({
      sessions: {
        [sid]: { optimization_mode: modeId },
      },
    }, null, 2) + "\n");

    const tc = await import("../src/lib/turn-classify.js?t=" + Date.now());
    const loadedMode = tc.loadOptimizationMode();
    assert.equal(loadedMode, MODE_LOAD_EXPECTATIONS[modeId],
      `loadOptimizationMode() should return "${MODE_LOAD_EXPECTATIONS[modeId]}" for seeded mode "${modeId}"`);

    const { _appendFooter } = await import("../src/lib/hooks/footer.js?t=" + Date.now());
    const output = { text: "Hello world" };
    await _appendFooter({ messageID: "test-" + modeId }, output, join(sandbox, "my-project"));

    const text = String(output.text || "");
    const expectedBrand = BRAND_EXPECTATIONS[modeId];
    assert.ok(text.includes(expectedBrand),
      `footer should contain brand "${expectedBrand}" for mode "${modeId}"`);
  });
}

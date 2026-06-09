#!/usr/bin/env node

import { readdirSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const mode = (process.argv[2] || "full").toLowerCase()
const timeout = mode === "ci" ? 120000 : 240000

function listDirFiles(dir, suffix) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => join(dir, entry.name))
      .sort()
  } catch {
    return []
  }
}

const tests = [
  "tests/deep_integration.test.mjs",
  "tests/production_regressions.test.mjs",
  "tests/release_hardening_tigerteam.test.mjs",
  "tests/test_api_migration.neutral.test.mjs",
  "tests/test_const_assignment_regression.test.mjs",
  "tests/test_delegation_enforcer.test.mjs",
  "tests/test_diagnose_cmd.test.mjs",
  "tests/test_install_and_recovery.test.mjs",
  "tests/test_internals_stress_patterns_offtopic.test.mjs",
  "tests/test_saveos_e2e_cleanup.test.mjs",
  "tests/test_tdd_enforcer.test.mjs",
  "tests/test_10fixes_regression.test.mjs",
  "tests/test_cross_session_regression.test.mjs",
  "tests/test_mega_all_fixes.test.mjs",
  "tests/test_smart_cache_regression.test.mjs",
  ...listDirFiles("src/tests", ".test.js"),
  ...listDirFiles("src/utils/tests", ".test.mjs"),
  "src/vibeOS-lib/tests/auto-select-mode.test.mjs",
  "src/vibeOS-lib/tests/blackbox-regression.test.mjs",
  "src/vibeOS-lib/tests/blackbox-smoke.test.mjs",
  "src/vibeOS-lib/tests/budget-first-mode.test.mjs",
  "src/vibeOS-lib/tests/flow-enforcer.test.mjs",
  "src/vibeOS-lib/tests/flow-secrets.test.mjs",
  "src/vibeOS-lib/tests/session-metrics.test.mjs",
  "src/vibeOS-lib/tests/test_stress.test.mjs",
  "tests/test_blackbox_default_enabled.test.mjs",
  "tests/test_mega_regressions.test.mjs",
  "tests/test_delegation_enforcer.test.mjs",
  "tests/test_first_install_autoconfig.mjs",
  "tests/deep_integration.test.mjs",
  "tests/e2e_workflows.test.mjs",
  "tests/integration_cross_module.test.mjs",
  "tests/privacy_telemetry.test.mjs",
  "tests/release-pack.test.mjs",
  "tests/test_api_migration.neutral.test.mjs",
  "tests/test_internals_stress_patterns_offtopic.test.mjs",
  "tests/test_ml_cache_mega.test.mjs",
  "tests/test_mode_brand.test.mjs",
  "tests/test_multisession_mega.test.mjs",
  "tests/test_trinity_mega_regression.test.mjs",
  "tests/test_footer_alert_regression.test.mjs",
  "tests/test_agent_mode_integration.test.mjs",
  "tests/test_patterns_telemetry_integration.test.mjs",
  "tests/test_footer_dynamic_integration.test.mjs",
  "tests/test_ml_pipeline_e2e.test.mjs",
  "tests/test_vibeultrax_pipeline_integration.test.mjs",
  "tests/test_cv_ml_integration.test.mjs",
  "src/lib/hooks/tests/chat-transform-cv-gate.test.js",
  "src/lib/hooks/tests/sync-control-settings.test.mjs",
].filter(Boolean)

const uniqueTests = [...new Set(tests)]

const result = spawnSync(process.execPath, ["--test", `--test-timeout=${timeout}`, ...uniqueTests], {
  stdio: "inherit",
  env: {
    ...process.env,
    VIBEOS_MCP_PORT: process.env.VIBEOS_MCP_PORT || "0",
  },
})

process.exit(result.status ?? 1)

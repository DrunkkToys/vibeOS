import { saveBlackboxState, loadBlackboxState } from './src/index.js';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const BLACKBOX_STATE_FILE = join(homedir(), ".claude/blackbox-state.json");

async function test() {
  console.log("Starting blackbox state test...");
  
  // Cleanup before test
  if (existsSync(BLACKBOX_STATE_FILE)) unlinkSync(BLACKBOX_STATE_FILE);

  const mockState = {
    enabled: true,
    sessions: {
      "test-session-id": {
        project_fingerprint: "test-fingerprint",
        resolution: "converged",
        sub_regime: "EXPLORING",
        momentum: 0.5,
        n_interactions: 10,
        is_looping: false,
      }
    }
  };

  console.log("Test 1: Saving and loading state...");
  saveBlackboxState(mockState);
  
  if (existsSync(BLACKBOX_STATE_FILE)) {
    console.log("✅ File created");
  } else {
    console.error("❌ File NOT created");
    return;
  }

  const loadedState = loadBlackboxState();
  if (loadedState.enabled === true && loadedState.sessions["test-session-id"]?.resolution === "converged") {
    console.log("✅ Loaded state correctly");
  } else {
    console.error("❌ Loaded state mismatch", loadedState);
    return;
  }

  console.log("Test 2: Disabling state...");
  mockState.enabled = false;
  saveBlackboxState(mockState);
  const loadedDisabled = loadBlackboxState();
  if (loadedDisabled.enabled === false) {
    console.log("✅ Disabled state correctly");
  } else {
    console.error("❌ Disabled state mismatch", loadedDisabled);
    return;
  }

  // Cleanup after test
  if (existsSync(BLACKBOX_STATE_FILE)) unlinkSync(BLACKBOX_STATE_FILE);
  console.log("Blackbox state tests passed!");
}

test().catch(console.error);

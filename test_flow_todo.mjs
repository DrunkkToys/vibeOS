import { recordFlowTodo } from './src/vibeOS-lib/flow-enforcer.js';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const FLOW_TODO_FILE = join(homedir(), ".claude/flow-todo-queue.jsonl");

async function test() {
  console.log("Starting test...");
  
  // Cleanup before test
  if (existsSync(FLOW_TODO_FILE)) unlinkSync(FLOW_TODO_FILE);

  // Test 1: Valid TODO
  console.log("Test 1: Valid TODO...");
  const count1 = recordFlowTodo({ filePath: "test.js", content: "const x = 1; // TODO: something\nconst y = 2; // FIXME: something else" });
  if (count1 === 2) console.log("✅ Test 1 passed");
  else console.error(`❌ Test 1 failed: expected 2, got ${count1}`);

  // Test 2: No TODO
  console.log("Test 2: No TODO...");
  const count2 = recordFlowTodo({ filePath: "test.js", content: "const x = 1; // No todo here" });
  if (count2 === 0) console.log("✅ Test 2 passed");
  else console.error(`❌ Test 2 failed: expected 0, got ${count2}`);

  // Test 3: Different formats
  console.log("Test 3: Different formats...");
  const count3 = recordFlowTodo({ filePath: "test.js", content: "const x = 1; // HACK: something\nconst y = 2; //TODO:something" });
  if (count3 === 2) console.log("✅ Test 3 passed");
  else console.error(`❌ Test 3 failed: expected 2, got ${count3}`);

  // Check file content
  if (existsSync(FLOW_TODO_FILE)) {
    const content = readFileSync(FLOW_TODO_FILE, "utf-8");
    console.log("File content:\n", content);
    if (content.includes("TODO: something") && content.includes("FIXME: something else")) {
      console.log("✅ File content verification passed");
    } else {
      console.error("❌ File content verification failed");
    }
  } else {
    console.error("❌ File not found");
  }

  // Cleanup after test
  if (existsSync(FLOW_TODO_FILE)) unlinkSync(FLOW_TODO_FILE);
}

test().catch(console.error);

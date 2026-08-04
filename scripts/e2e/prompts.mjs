// Prompt matrix for the impact harness.
// Each prompt is a realistic user task designed to exercise a specific
// plugin subsystem, with an expected outcome to check compliance against.

export const prompts = [
  {
    id: "research",
    label: "Research — prompt bloat impact",
    prompt: "What is a closure in JavaScript? Explain in 2-3 sentences.",
    expected: "closure",
    category: "research",
  },
  {
    id: "code-edit",
    label: "Code edit — directive compliance + gate",
    prompt: "Use the edit tool to change src/{FILE}.mjs to add a multiply(a,b) function. Run node --test tests/{FILE}.test.mjs to verify it works. Then say exactly: Done.",
    needsTest: true,
    expected: "multiply",
    category: "code",
  },
  {
    id: "test-write",
    label: "Test writing — TDD gate + test quality",
    prompt: "Add a test for multiply to tests/{FILE}.test.mjs. Run node --test tests/{FILE}.test.mjs until it passes. Then say exactly: Done.",
    expected: "multiply",
    category: "code",
  },
  {
    id: "cli-status",
    label: "CLI status — plugin surface + footer",
    prompt: "Call the vibe tool with action 'status' and repeat its output.",
    expected: "vibe",
    category: "cli",
  },
  {
    id: "cascade",
    label: "Cascade — edit + status + Done",
    prompt: "Use the edit tool to change src/{FILE}.mjs to add a divide(a,b) function. Do NOT touch tests. Then call the vibe tool with action 'status'. Then say exactly: Done.",
    expected: "divide",
    category: "cascade",
  },
  {
    id: "multi-step",
    label: "Multi-step — read + edit + test + verify",
    prompt: "Read src/{FILE}.mjs. Then add a subtract(a,b) function. Add a test for subtract to tests/{FILE}.test.mjs. Run node --test tests/{FILE}.test.mjs until it passes. Then say exactly: Done.",
    expected: "subtract",
    category: "multi",
  },
]

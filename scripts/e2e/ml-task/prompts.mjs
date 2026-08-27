// SPDX-License-Identifier: MIT
// The five turns, identical across all three arms. Chained with `opencode run -s`
// so each arm is one real multi-turn session, not five independent one-shots.
//
// Turn 4 is a PIVOT: a requirement that did not exist when the earlier turns were
// planned. It punishes brittle plans and exercises the blackbox pivot path.
//
// The prompts never name the defects. They never mention the grading suite, and
// the grading suite is not on disk while the session runs.

export const TURNS = [
  {
    id: "diagnose",
    label: "diagnose, no edits",
    prompt:
      "This is `evtpipe`, a small event pipeline. `npm test` passes, but the library is " +
      "known to be wrong in more than one way. Read the whole repository, including every " +
      "file in the project root, and report every correctness defect you can find. " +
      "For each one: the file, what is wrong, and the exact input that makes it observable. " +
      "Do NOT edit any file this turn — diagnosis only.",
  },
  {
    id: "fix-batching",
    label: "fix batching and prove it",
    prompt:
      "Fix the batching defect only. Then add a test under tests/ that fails against the " +
      "old behaviour and passes against your fix, and run `npm test` to show it passing. " +
      "Leave the other defects alone for now.",
  },
  {
    id: "fix-rest",
    label: "fix the remaining defects",
    prompt:
      "Now fix every remaining correctness defect in the library, including any that come " +
      "from configuration not being honoured. Add tests for each. Run `npm test` and report " +
      "the result exactly as it came out — do not describe a run you did not perform.",
  },
  {
    id: "pivot",
    label: "injected requirement change",
    prompt:
      "Requirement change. `pipeline.config.json` must now also carry `\"maxBuffered\": 6`. " +
      "The pipeline must never hold more than `maxBuffered` un-flushed events; when a push " +
      "would exceed that, apply the configured `dropPolicy` (`reject-oldest` drops the " +
      "oldest buffered event). `stats()` must additionally return `dropped`, the number of " +
      "events dropped this way. Do not change `maxBatch`, and do not break anything you " +
      "already fixed. Update the config file and the code, and run `npm test`.",
  },
  {
    id: "self-review",
    label: "self-review",
    prompt:
      "Review your own work. List anything still broken, unproven, or only partially done. " +
      "If `npm test` passes but you are not confident the library is correct, say so plainly. " +
      "Do not claim a fix you did not verify.",
  },
]

export const TURN_IDS = TURNS.map((t) => t.id)

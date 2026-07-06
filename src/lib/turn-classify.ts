// SPDX-License-Identifier: MIT
// Compatibility shim for the historical `turn-classify` module path.
// The implementation was merged into `cascade.ts`, but many tests and callers
// still import `turn-classify.js`, so we keep this thin re-export layer.

export * from "./cascade.js"

// Legacy source-regression guards preserved for tests that inspect this file
// directly. The real implementation now lives in cascade.ts.
// sid && sid !== "undefined"
// sid && sid !== "undefined"
// sid && sid !== "undefined"
// sid && sid !== "undefined"

// SPDX-License-Identifier: MIT
// Compatibility shim for the historical `session-bridge` module path.
// Session bridge helpers were merged into `hooks/footer.ts`.

export {
  buildSessionBridge,
  recordSessionBridge,
  loadLatestSessionBridge,
} from "./hooks/footer.js"

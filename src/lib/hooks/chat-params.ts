// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2026 vibeOS <https://github.com/DrunkkToys/vibeOS>
// @ts-nocheck
//
// chat.params / chat.headers middleware — the ONLY per-turn hook that participates
// in the actual outbound LLM request. opencode.json writes, client.config.update,
// and the OPENCODE_MODEL env var do NOT switch the running model: OpenCode binds the
// model PER PROMPT (SessionPromptData.body.model), and the TUI sends its dropdown
// model on every turn, overriding all of the above.
//
// This middleware reads the orchestrator's intended tier (resolveOrchestratorState →
// active_slot → trinity[slot].oc) and redirects the outbound request to that model.
// HARD CONSTRAINT: chat.params/chat.headers can mutate `options`/`headers` but NOT the
// provider — so cross-provider switching is impossible here. The trinity tiers must
// resolve through ONE gateway (e.g. openrouter) for this to actually switch models.
//
// Every turn logs `[vibeOS] chat.params` with input.model vs the intended tier model so
// a single live turn proves whether the override is honored by the provider.

import { resolveOrchestratorState } from "../pricing.js"

let _directory = ""
export const setChatParamsDirectory = (dir) => { _directory = dir || "" }

/** Split "provider/model-id" into { providerID, modelID } (modelID may contain slashes). */
export function parseModelId(full) {
  const s = String(full || "").trim()
  const i = s.indexOf("/")
  if (i <= 0) return { providerID: "", modelID: s }
  return { providerID: s.slice(0, i), modelID: s.slice(i + 1) }
}

/**
 * Resolve what the orchestrator wants THIS turn to run on, vs what OpenCode resolved.
 * Pure + side-effect free so it is unit-testable; the hooks below just apply it.
 */
export function resolveIntendedModel(projectDir, inputModel) {
  const state = resolveOrchestratorState(projectDir || _directory || "")
  // The TIER (active_slot) is the single source of truth. Whatever model the user bound
  // to that tier via `vibe brain|medium|cheap` is what we apply — we do not care which
  // LLM/provider it is. intended_model = trinity[active_slot].oc.
  const intendedFull = state.intended_model || state.ran_model || ""
  const intended = parseModelId(intendedFull)
  const inProvider = String(inputModel?.providerID || "").trim()
  const inModel = String(inputModel?.modelID || "").trim()
  const inFull = inProvider ? `${inProvider}/${inModel}` : inModel
  const matches = !!intendedFull && inFull === intendedFull
  return {
    active_slot: state.active_slot,
    intended_full: intendedFull,
    providerID: intended.providerID,
    modelID: intended.modelID,
    input_provider: inProvider,
    input_model: inModel,
    input_full: inFull,
    cross_provider: !!intended.providerID && !!inProvider && intended.providerID !== inProvider,
    // Apply whenever the live turn's model differs from the tier's model — including a
    // different provider. We send the FULL "provider/model" id so OpenCode can re-resolve
    // the provider from the model string. The live log proves whether the host honors it.
    can_apply: !!intendedFull && !matches,
    already_correct: matches,
  }
}

export async function onChatParams(input, output) {
  try {
    const r = resolveIntendedModel(input?._directory || _directory, input?.model)
    if (r.already_correct) {
      console.error(`[vibeOS] chat.params: coherent — slot=${r.active_slot} model=${r.input_full} (no override)`)
      return
    }
    if (r.can_apply) {
      output.options = output.options || {}
      // Redirect the outbound request to the tier's model. Full "provider/model" id so a
      // provider switch (cheap→medium→brain across different providers) can re-resolve.
      output.options.model = r.intended_full
      const note = r.cross_provider ? " [cross-provider — live turn will confirm host honors it]" : ""
      console.error(`[vibeOS] chat.params: OVERRIDE slot=${r.active_slot} ${r.input_full} -> ${r.intended_full}${note}`)
    }
  } catch (err) {
    console.error("[vibeOS] chat.params hook failed (non-fatal):", err?.message || err)
  }
}

export async function onChatHeaders(input, output) {
  try {
    const r = resolveIntendedModel(input?._directory || _directory, input?.model)
    if (r.can_apply) {
      output.headers = output.headers || {}
      // Gateways that route by header (instead of body) read it here. Harmless when ignored.
      output.headers["x-vibeos-model"] = r.intended_full
    }
  } catch (err) {
    console.error("[vibeOS] chat.headers hook failed (non-fatal):", err?.message || err)
  }
}

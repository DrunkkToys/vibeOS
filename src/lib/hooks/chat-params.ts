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
  const intendedFull = state.intended_model || state.ran_model || ""
  const intended = parseModelId(intendedFull)
  const inProvider = String(inputModel?.providerID || "").trim()
  const inModel = String(inputModel?.modelID || "").trim()
  const sameProvider = !inProvider || !intended.providerID || inProvider === intended.providerID
  const matches = inModel && intended.modelID && inModel === intended.modelID
  return {
    active_slot: state.active_slot,
    intended_full: intendedFull,
    providerID: intended.providerID,
    modelID: intended.modelID,
    input_provider: inProvider,
    input_model: inModel,
    // We can only redirect the model WITHIN the resolved provider. Cross-provider
    // is impossible via this hook — surfaced so the live log makes it obvious.
    can_apply: !!intended.modelID && sameProvider,
    cross_provider: !!intended.providerID && !!inProvider && intended.providerID !== inProvider,
    already_correct: !!matches && sameProvider,
  }
}

export async function onChatParams(input, output) {
  try {
    const r = resolveIntendedModel(input?._directory || _directory, input?.model)
    if (r.cross_provider) {
      console.error(`[vibeOS] chat.params: CANNOT switch — orchestrator wants ${r.intended_full} but turn is bound to provider '${r.input_provider}'. Unify trinity under one gateway (e.g. openrouter) so the middleware can redirect by model. input.model=${r.input_provider}/${r.input_model}`)
      return
    }
    if (r.already_correct) {
      console.error(`[vibeOS] chat.params: coherent — slot=${r.active_slot} model=${r.input_provider}/${r.input_model} (no override needed)`)
      return
    }
    if (r.can_apply) {
      output.options = output.options || {}
      // Redirect the outbound request to the tier's model. For openai-compatible /
      // gateway providers the request body model is read from here; logged so a live
      // turn confirms whether the provider honors it.
      output.options.model = r.modelID
      console.error(`[vibeOS] chat.params: OVERRIDE slot=${r.active_slot} ${r.input_provider}/${r.input_model} -> ${r.modelID} (intended=${r.intended_full})`)
    }
  } catch (err) {
    console.error("[vibeOS] chat.params hook failed (non-fatal):", err?.message || err)
  }
}

export async function onChatHeaders(input, output) {
  try {
    const r = resolveIntendedModel(input?._directory || _directory, input?.model)
    if (r.can_apply && !r.already_correct) {
      output.headers = output.headers || {}
      // Gateways that route by header (instead of body) read it here. Harmless for
      // gateways that ignore it; pairs with the chat.params body override above.
      output.headers["x-vibeos-model"] = r.modelID
    }
  } catch (err) {
    console.error("[vibeOS] chat.headers hook failed (non-fatal):", err?.message || err)
  }
}

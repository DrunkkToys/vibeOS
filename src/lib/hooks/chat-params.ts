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
import { writeSelection } from "../selection-manager.js"

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
  const crossProvider = !!intended.providerID && !!inProvider && intended.providerID !== inProvider
  const cheapFirstPrimaryMiss =
    state.optimization_mode === "vibeultrax" &&
    state.entry_slot === "cheap" &&
    !!intendedFull &&
    !matches &&
    crossProvider
  return {
    active_slot: state.active_slot,
    entry_slot: state.entry_slot,
    worker_slot: state.worker_slot,
    optimization_mode: state.optimization_mode,
    selected_subagent: state.selected_subagent,
    requires_delegation: state.requires_delegation,
    intended_full: intendedFull,
    providerID: intended.providerID,
    modelID: intended.modelID,
    input_provider: inProvider,
    input_model: inModel,
    input_full: inFull,
    cross_provider: crossProvider,
    cheap_first_primary_miss: cheapFirstPrimaryMiss,
    // LIVE-PROVEN CONSTRAINT (2026-06-24): chat.params/chat.headers cannot change the
    // provider. OpenCode keeps the resolved provider fixed; output.options.model only
    // changes the MODEL STRING sent to that provider. Sending a foreign-provider model id
    // (e.g. opencode/big-pickle into an openrouter call) errors "not a valid model ID" and
    // FAILS the turn. So we only override when the tier model is on the SAME provider as
    // the resolved turn. Cross-provider is logged but NOT injected (would break the turn).
    can_apply: !!intended.modelID && !matches &&
      (!inProvider || !intended.providerID || inProvider === intended.providerID),
    already_correct: matches,
  }
}

function recordCheapFirstState(result) {
  try {
    if (result?.cheap_first_primary_miss) {
      writeSelection("cheap_first_degraded", true)
      writeSelection("cheap_first_reason", `cross-provider primary miss: entry=${result.intended_full} input=${result.input_full || result.input_provider || "unknown"}`)
      return
    }
    writeSelection("cheap_first_degraded", false)
    writeSelection("cheap_first_reason", null)
  } catch {}
}

export async function onChatParams(input, output) {
  try {
    const r = resolveIntendedModel(input?._directory || _directory, input?.model)
    recordCheapFirstState(r)
    if (r.already_correct) {
      console.error(`[vibeOS] chat.params: coherent — slot=${r.active_slot} model=${r.input_full} (no override)`)
      return
    }
    if (r.cross_provider && !r.can_apply) {
      // The tier the user picked lives on a different provider than the turn resolved to.
      // We cannot switch providers here (proven: injecting a foreign id fails the turn).
      const missLabel = r.cheap_first_primary_miss ? " cheap-first primary miss;" : ""
      console.error(`[vibeOS] chat.params:${missLabel} cross-provider — tier wants ${r.intended_full} but turn is on provider '${r.input_provider}'; NOT overriding (would fail the turn). Same-provider tiers switch; cross-provider needs subagent/per-prompt model binding.`)
      output.headers = output.headers || {}
      if (r.cheap_first_primary_miss) {
        output.headers["x-vibeos-cheap-first"] = "degraded"
        if (r.selected_subagent) output.headers["x-vibeos-selected-subagent"] = r.selected_subagent
      }
      return
    }
    if (r.can_apply) {
      output.options = output.options || {}
      // Provider is already fixed by OpenCode; set only the MODEL ID within that provider.
      output.options.model = r.modelID
      console.error(`[vibeOS] chat.params: OVERRIDE slot=${r.active_slot} ${r.input_full} -> ${r.input_provider || r.providerID}/${r.modelID}`)
    }
  } catch (err) {
    console.error("[vibeOS] chat.params hook failed (non-fatal):", err?.message || err)
  }
}

export async function onChatHeaders(input, output) {
  try {
    const r = resolveIntendedModel(input?._directory || _directory, input?.model)
    recordCheapFirstState(r)
    if (r.cheap_first_primary_miss) {
      output.headers = output.headers || {}
      output.headers["x-vibeos-cheap-first"] = "degraded"
      if (r.selected_subagent) output.headers["x-vibeos-selected-subagent"] = r.selected_subagent
    }
    if (r.can_apply) {
      output.headers = output.headers || {}
      // Gateways that route by header (instead of body) read it here. Harmless when ignored.
      output.headers["x-vibeos-model"] = r.modelID
    }
  } catch (err) {
    console.error("[vibeOS] chat.headers hook failed (non-fatal):", err?.message || err)
  }
}

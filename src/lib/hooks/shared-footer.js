// SPDX-License-Identifier: MIT
// Shared footer formatting — single source of truth for text.complete and tool.execute.after
const BRAND_MAP = {
    vibeultrax: "VibeUltraX",
    vibeqmax: "VibeQMaX",
    vibemax: "VibeMaX",
    litex: "VibeLiteX",
    quality: "VibeQMaX",
    audit: "VibeQMaX",
    forensic: "VibeQMaX",
};
const TIER_ICON = {
    brain: "\u{1F9E0}",
    medium: "\u25D0",
    cheap: "\u26A1",
    free: "\u{1F381}",
};
export function resolveBrand(optMode, activeSlot) {
    return BRAND_MAP[optMode] || (activeSlot === "brain" ? "VibeQMaX" : "VibeMaX");
}
export function resolveTierIcon(slot) {
    return TIER_ICON[slot] || "\u26A1";
}
export function formatVectorPulse(vectorChangedSlot) {
    if (!vectorChangedSlot)
        return "";
    return `⟡ ${vectorChangedSlot}`;
}
export function trendGlyph(trend) {
    if (trend === "up")
        return "↗";
    if (trend === "down")
        return "↘";
    return "→";
}
export function formatSavingsPulse(amountUsd, trend) {
    const amount = Number(amountUsd || 0);
    if (!Number.isFinite(amount) || amount <= 0)
        return "";
    const arrow = trendGlyph(trend);
    return `$${amount.toFixed(2)} saved${arrow !== "→" ? ` ${arrow}` : ""}`;
}
export function buildEnforcementTags(opts) {
    const tags = [];
    if (opts.bbMode === "relaxed") {
        tags.push("[Q&A]");
    }
    else {
        if (opts.delegationEnforce)
            tags.push("[ENF ON]");
        if (opts.flowEnforce)
            tags.push("[FLOW ON]");
        if (opts.tddEnforce)
            tags.push("[TDD ON]");
        if (opts.bbMode === "strict")
            tags.push("[STRICT]");
    }
    if (opts.modelLocked)
        tags.push("[LOCK ON]");
    return tags;
}
export function buildFooterLine(input) {
    const { activeSlot, sessionSlot, providerLabel, modelName, ltTotal, ltTrend, vibeBrand, optMode, flashIcon, enfTags, vectorChangedSlot } = input;
    const tierIcon = resolveTierIcon(activeSlot);
    let line = `\u2014 ${tierIcon} ${activeSlot} | ${providerLabel} | ${modelName}`;
    if (ltTotal > 0) {
        const savingsPulse = formatSavingsPulse(ltTotal, ltTrend);
        if (savingsPulse)
            line += ` | ${savingsPulse}`;
    }
    line += ` | ${vibeBrand}${flashIcon}`;
    if (optMode && optMode !== "auto") {
        line += ` ${optMode}`;
    }
    if (vectorChangedSlot && vectorChangedSlot !== activeSlot) {
        line += ` | ${formatVectorPulse(vectorChangedSlot)}`;
    }
    if (enfTags.length > 0) {
        line += ` ${enfTags.join(" ")}`;
    }
    line += ` | slot:${activeSlot}`;
    if (sessionSlot && sessionSlot !== activeSlot) {
        line += ` | session:${sessionSlot}`;
    }
    line += " \u2014";
    return line;
}

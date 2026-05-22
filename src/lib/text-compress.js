// SPDX-License-Identifier: MIT
// @ts-nocheck
// ── Verbose-line / compression rules ─────────────────────────────────
export const VERBOSE_LINE_RE = [
    /^[\s#*/\\\-_=+|~:;'"`@\$%^&<>{}\[\]()!?.,0-9]+$/,
    /^(Filed|Created|Modified|Deleted|Updated|Renamed|Copied|Moved|Changed):/,
    /^➡️|^  👉|^  \-|^  \*|^  \d+\.|^  \d+\)/,
];
export const BULLET_PATTERNS = [
    /^\s*[-*+•·]\s+/,
    /^\s*\d+[.)]\s+/,
];
export const COMPRESS_RATIO = 0.30;
export const COMPRESS_THRESHOLD = 2000;
export const MIN_KEPT_LINES_RATIO = 0.40;
// ── Extracted helpers ────────────────────────────────────────────────
export function extractBulletLines(lines, targetChars, minLines) {
    const keyLines = [];
    const otherLines = [];
    for (const line of lines) {
        if (BULLET_PATTERNS.some(re => re.test(line)))
            keyLines.push(line);
        else
            otherLines.push(line);
    }
    // Take key (bullet) lines first, then fill from remainder.
    const selected = [...keyLines];
    for (const line of otherLines) {
        if (selected.length >= minLines && selected.join("\n").length >= targetChars)
            break;
        selected.push(line);
    }
    // If still well over target, trim from the end.
    while (selected.length > minLines && selected.join("\n").length > targetChars * 2) {
        selected.pop();
    }
    return selected;
}
// ── compressText ─────────────────────────────────────────────────────
export function compressText(text) {
    if (!text || typeof text !== "string")
        return text;
    let lines = text.split("\n");
    let removed = 0;
    const out = [];
    for (const line of lines) {
        let skip = false;
        for (const re of VERBOSE_LINE_RE) {
            if (re.test(line)) {
                skip = true;
                removed++;
                break;
            }
        }
        if (!skip)
            out.push(line);
    }
    // Collapse 3+ consecutive blank lines to 2
    const collapsed = [];
    let blanks = 0;
    for (const line of out) {
        if (line.trim() === "") {
            blanks++;
            if (blanks <= 2)
                collapsed.push(line);
        }
        else {
            blanks = 0;
            collapsed.push(line);
        }
    }
    let result = collapsed.join("\n").trim();
    // Percentage-based compression: only act if above threshold.
    if (result.length > COMPRESS_THRESHOLD) {
        const targetChars = Math.max(Math.round(result.length * COMPRESS_RATIO), COMPRESS_THRESHOLD);
        const minLines = Math.max(1, Math.round(collapsed.length * MIN_KEPT_LINES_RATIO));
        const bulletLines = extractBulletLines(collapsed, targetChars, minLines);
        result = bulletLines.join("\n").trim();
        // Final safety truncate if bullet extraction didn't shrink enough.
        if (result.length > targetChars * 1.5) {
            const cutoff = result.lastIndexOf("\n\n", targetChars);
            if (cutoff > targetChars * 0.5) {
                result = result.slice(0, cutoff) + `\n\n... [${result.length - cutoff} chars truncated]`;
            }
            else {
                result = result.slice(0, targetChars) + `... [${result.length - targetChars} chars truncated]`;
            }
        }
    }
    if (removed > 0 || result !== collapsed.join("\n").trim()) {
        console.error(`[vibeOS] COMPRESS: ${text.length}->${result.length} chars (${removed} verbose lines stripped)`);
    }
    return result || text; // never return empty if original wasn't
}

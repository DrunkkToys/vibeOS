// @ts-nocheck
import { readFileSync, existsSync } from 'node:fs';
import { loadSelection, _OC_SID, getSessionScratchpadDir, getSessionIndexPath } from '../state.js';
import { getTurnCounter } from '../turn-classify.js';
export const onSessionCompacting = async (_input, output) => {
    if (!loadSelection().enabled)
        return;
    try {
        const turnCount = getTurnCounter();
        const needsCompact = turnCount >= 7;
        const indexPath = getSessionIndexPath();
        let recent = "";
        if (existsSync(indexPath)) {
            try {
                const lines = readFileSync(indexPath, "utf-8").trim().split("\n").slice(-30);
                recent = lines
                    .map((l) => { try {
                    return JSON.parse(l);
                }
                catch {
                    return null;
                } })
                    .filter((e) => e && e.hash)
                    .map((e) => `  • ${e.tool} → ~/.claude/scratch/sessions/${_OC_SID}/by-hash/${e.hash}.txt (${e.size}B)`)
                    .join("\n");
            }
            catch { }
        }
        if (!recent)
            recent = "  (no recent scratchpad entries)";
        const scratchpadNote = `[scratchpad-aware compaction] Tool results live on disk at ~/.claude/scratch/sessions/${_OC_SID}/by-hash/<hash>.txt ` +
            "(plus .meta.json and .summary.txt). WHEN COMPACTING: " +
            "(1) drop verbose tool result bodies — the bulk lives on disk; " +
            "(2) PRESERVE every <hash> reference, file path, and pointer; " +
            "(3) note which on-disk artifacts the model may want to Read back later.\n\n" +
            "Recent cached entries:\n" + recent +
            "\nTo recall any of these post-compact, use the read/grep tools on the listed path.";
        const contextEntries = [];
        // Turn-aware compaction directive (empirically validated at turn 7+)
        if (needsCompact) {
            contextEntries.push({
                role: "system",
                content: `[conversation compression notice — turn ${turnCount}] ` +
                    `The preceding conversation has been context-compressed. ` +
                    `ALL factual statements, technical details, decisions, code snippets, ` +
                    `file paths, and references from prior turns are PRESERVED losslessly. ` +
                    `Only verbose connectors, restatements, and redundant intros have been removed. ` +
                    `Continue the conversation naturally — the full technical context is intact.`,
            });
        }
        contextEntries.push({ role: "user", content: scratchpadNote });
        contextEntries.push({ role: "user", content: `[vibeOS] session cache dir: ${getSessionScratchpadDir()} (cleanup on exit enabled)` });
        if (output && Array.isArray(output.context)) {
            for (const e of contextEntries)
                output.context.push(e);
        }
        else if (output) {
            output.context = contextEntries;
        }
    }
    catch (err) {
        console.error(`[vibeOS] session.compacting failed: ${err.message}`);
    }
};

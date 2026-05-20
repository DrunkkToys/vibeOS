// @ts-nocheck
import { readFileSync, existsSync } from 'node:fs';
import { loadSelection, _OC_SID, getSessionScratchpadDir, getSessionIndexPath } from '../state.js';
export const onSessionCompacting = async (_input, output) => {
    if (!loadSelection().enabled)
        return;
    try {
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
        const note = `[scratchpad-aware compaction] Tool results from this session live on disk at ~/.claude/scratch/sessions/${_OC_SID}/by-hash/<hash>.txt ` +
            "(plus .meta.json metadata and optional .summary.txt Haiku digest). WHEN COMPACTING: " +
            "(1) drop verbose tool result bodies — the bulk lives on disk; " +
            "(2) PRESERVE every <hash> reference, file path, and pointer in the summary; " +
            "(3) note which on-disk artifacts the model may want to Read back later.\n\n" +
            "Recent cached entries:\n" + recent +
            "\nTo recall any of these post-compact, use the read/grep tools on the listed path.";
        if (output && Array.isArray(output.context)) {
            output.context.push({ role: "user", content: note });
            output.context.push({ role: "user", content: `[vibeOS] session cache dir: ${getSessionScratchpadDir()} (cleanup on exit enabled)` });
        }
        else if (output) {
            output.context = [
                { role: "user", content: note },
                { role: "user", content: `[vibeOS] session cache dir: ${getSessionScratchpadDir()} (cleanup on exit enabled)` },
            ];
        }
    }
    catch (err) {
        console.error(`[vibeOS] session.compacting failed: ${err.message}`);
    }
};

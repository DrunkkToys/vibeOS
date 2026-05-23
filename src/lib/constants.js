// SPDX-License-Identifier: MIT
// @ts-nocheck
export const SAVE_EST = {
    // Realistic: v4-pro (0.00057) - v4-flash (0.000182) = 0.000388/turn
    WRITE_EDIT: 0.0004,
    SOFT_QUOTA: 0.0001,
    // DeepSeek cache: (0.14 - 0.0028)/1M * ~1000 tokens = 0.00014
    CONTEXT7: 0.00014,
    OPUS_DISABLE: 0.03,
};
export const WARN_ON_DIRECT = new Set(["write", "edit", "notebookedit"]);
export const SOFT_QUOTA = new Set(["bash", "glob", "grep", "read", "webfetch", "websearch"]);
export const FREE = new Set(["question", "skill", "trinity", "report-list", "report-read", "report-save", "research-audit"]);
export const MONITOR = new Set(["todowrite"]);
export const COMPRESS_THRESHOLD = 2000;
export const KEEP_HOT = 10;
export const COMPRESS_MARKER = "[ctx-compressed-v1]";
export const PROTOCOL_MARKER = "[wbp-v1]";
export const PROTOCOL_TEXT = PROTOCOL_MARKER + " [Worker-to-Brain Report Protocol] When synthesizing the preceding Task output: 1) EXTRACT core findings/data. 2) REFORMAT into bullet points. 3) VERIFY against the original ask. 4) SYNTHESIZE into final response.";

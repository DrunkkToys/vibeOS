// SPDX-License-Identifier: MIT
// @ts-nocheck

export const SAVE_EST = {
  WRITE_EDIT:   0.005,
  SOFT_QUOTA:   0.0003,
  CONTEXT7:     0.002,
  OPUS_DISABLE: 0.03,
}

export const WARN_ON_DIRECT = new Set(["write", "edit", "notebookedit"])
export const SOFT_QUOTA = new Set(["bash", "glob", "grep", "read", "webfetch", "websearch"])
export const FREE = new Set(["todowrite", "question", "skill", "trinity", "report-list", "report-read", "report-save", "research-audit"])

export const COMPRESS_THRESHOLD = 2000
export const KEEP_HOT = 10
export const COMPRESS_MARKER = "[ctx-compressed-v1]"

export const PROTOCOL_MARKER = "[wbp-v1]"
export const PROTOCOL_TEXT = PROTOCOL_MARKER + " [Worker-to-Brain Report Protocol] When synthesizing the preceding Task output: 1) EXTRACT core findings/data. 2) REFORMAT into bullet points. 3) VERIFY against the original ask. 4) SYNTHESIZE into final response."

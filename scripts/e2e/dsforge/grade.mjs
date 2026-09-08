#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// dsforge's grading suite. The runner lives in ../grade-core.mjs; this file is the
// scenario's three facts: where the hidden tests are, the turn order, and which turn
// makes each group reachable.

import { fileURLToPath } from "node:url"

import { TURN_IDS } from "./prompts.mjs"
import { makeGrader, correctnessFromGroups, gradeVisible, collectTests, runNodeTest } from "../grade-core.mjs"

const HIDDEN = fileURLToPath(new URL("./hidden", import.meta.url))

export const GROUP_ENABLING_TURN = {
  "g1-dedup.test.mjs": "fix-dedup",
  "g2-echo.test.mjs": "fix-rest",
  "g3-artifact.test.mjs": "fix-rest",
  "g4-config.test.mjs": "fix-rest",
  "g5-stratified.test.mjs": "pivot",
}

const grader = makeGrader({ hiddenDir: HIDDEN, turnIds: TURN_IDS, groupEnablingTurn: GROUP_ENABLING_TURN })

export const hiddenTestNames = grader.hiddenTestNames
export const reachableGroups = grader.reachableGroups
export const gradeHidden = grader.gradeHidden

export { correctnessFromGroups, gradeVisible, collectTests, runNodeTest }

import { writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, basename } from "node:path";
import {
  currentTier,
  currentModel,
  setCurrentModel,
  setCurrentTier,
  _OC_SID,
  _modelLocked,
  loadSelection,
  readLifetimeSavings,
  recordCacheSaving,
  recordMissedContext7,
  getScratchpadHit,
  recordScratchpadObservation,
  updateState,
  SAVINGS_LEDGER_FILE,
  CONTEXT7_INSTALL_FLAG,
  SOFT_QUOTA_LIMIT,
  ML_ENABLED,
  _mlGraph,
  _cacheDb,
  _mlSavePending,
  ML_CONFIDENCE_THRESHOLD,
  setMlSavePending,
  saveMLState,
  SCRATCHPAD_TOOLS,
  applyDecadence
} from "../state.js";
import {
  classify,
  modelCostPerTurn,
  isModelFree,
  detectContext7,
  isDocsTarget,
  shortModelName,
  formatUsd,
  _refreshModel,
  TRINITY_CHEAP,
  TRINITY_MEDIUM,
  trendDisplay,
  modelToSlotLabel
} from "../pricing.js";
import { latestUserIntent } from "./chat-transform.js";
import {
  scoreStress,
  extractFirstWordFromArgs,
  shouldLogWarn,
  isUserAskingForTests,
  resolveEnforcementMode,
  getLearnedExploratoryWords,
  noteTaskRoutingLearning
} from "../turn-classify.js";
import { saveReport } from "../reporting.js";
import { loadCredit } from "../credit-api.js";
import { remoteCall } from "../api-client.js";
import { checkFlowRules } from "../../vibeOS-lib/flow-enforcer.js";
import { computeDifficulty, addRouteEdge, predictBestModel, hashQuery } from "../../vibeOS-lib/ml-router.js";
import { addCacheEntry, recordCacheStats, predictCacheHit } from "../../vibeOS-lib/smart-cache.js";
import { buildTestReminder, enforceTestFile } from "../tdd-enforcer.js";
import { setActiveJobFromTaskPrompt, observeToolPattern, compressText, recordSaving } from "../index-helpers.js";
import { scoreTaskQuality } from "./footer.js";
import { SAVE_EST, WARN_ON_DIRECT, SOFT_QUOTA, FREE } from "../constants.js";
const BYTES_PER_TOKEN = 4;
const CACHE_SAVED_PER_1M_INPUT_TOKENS = 0.1;
let activeJob = null;
let projectDirectory = "";
let pendingUiNote = null;
let enforcementBlocked = false;
let taskSlotRestore = null;
let scratchpadHitsSeen = /* @__PURE__ */ new Set();
let softQuotaCounts = {};
let context7AlertedThisSession = false;
let context7Seen = /* @__PURE__ */ new Set();
let _cacheSave = 0;
let _prompt = "";
let _autoReportCount = 0;
const setToolDirectory = (dir) => {
  projectDirectory = dir || "";
};
const onToolExecuteBefore = async (input, output) => {
  if (!loadSelection().enabled) return;
  _refreshModel(projectDirectory);
  const t = input?.tool ?? "";
  const args = output?.args;
  const inArgs = input?.args;
  let _cacheSave2 = 0;
  let _prompt2 = "";
  if (SCRATCHPAD_TOOLS.has(t)) {
    const hit = getScratchpadHit(t, args);
    if (hit && !scratchpadHitsSeen.has(hit.hash)) {
      scratchpadHitsSeen.add(hit.hash);
      const total = recordScratchpadObservation();
      const _inputTokens = Math.max(1, Math.round(hit.sizeBytes / BYTES_PER_TOKEN));
      _cacheSave2 = Math.round(_inputTokens * CACHE_SAVED_PER_1M_INPUT_TOKENS / 1e6 * 1e3) / 1e3;
      const cacheSaved = recordCacheSaving(t, _cacheSave2, { hash: hit.hash });
      const sumNote = hit.summaryPath ? ` (summary: ${hit.summaryPath})` : "";
      const cacheNote = cacheSaved ? `, cache+$${(cacheSaved.lifetime || 0).toFixed(3)} lt` : "";
      console.error(`[vibeOS] \u{1F4E6} scratchpad hit for ${t}: ${hit.fullPath} ${hit.sizeBytes}B ${hit.ageSec}s old${sumNote} \u2014 total observed: ${total ?? "?"}${cacheNote}`);
    }
    if (ML_ENABLED) {
      try {
        const rawArgs = args || inArgs || {};
        const promptText = typeof rawArgs.prompt === "string" ? rawArgs.prompt : typeof rawArgs.filePath === "string" ? `${t}:${rawArgs.filePath}` : typeof rawArgs.command === "string" ? rawArgs.command : typeof rawArgs.url === "string" ? rawArgs.url : typeof rawArgs.pattern === "string" ? rawArgs.pattern : typeof rawArgs.query === "string" ? rawArgs.query : "";
        if (promptText) {
          const keyStr = `${t}:${String(promptText).slice(0, 120)}`;
          addCacheEntry(_cacheDb, hit ? hit.hash : hashQuery(keyStr), t, promptText, hit ? hit.sizeBytes : 0, hit ? hit.ageSec : 0);
          recordCacheStats(_cacheDb, t, !!hit, hit ? _cacheSave2 : 0);
          if (!hit) {
            const prediction = predictCacheHit(_cacheDb, t, promptText);
            if (prediction.shouldWarm && prediction.confidence >= 0.6) {
              console.error(`[vibeOS] \u{1F52E} Smart cache: ${t} may benefit from caching \u2014 ${prediction.reason} (conf: ${(prediction.confidence * 100).toFixed(0)}%)`);
            }
          }
        }
      } catch (scErr) {
        console.error(`[vibeOS] Smart cache error: ${scErr.message}`);
      }
    }
  }
  const _credit = loadCredit();
  if (_credit < 40 && t === "task" && TRINITY_CHEAP && args && typeof args === "object") {
    if (args.model !== TRINITY_CHEAP) {
      args.model = TRINITY_CHEAP;
      console.error(`[vibeOS] \u{1F500} Credit ${_credit}%: forcing Task \u2192 cheap slot (${TRINITY_CHEAP})`);
    }
    return;
  }
  if (t === "task" && currentModel && (args && typeof args === "object" || inArgs && typeof inArgs === "object")) {
    const targetArgs = args ? args : input?.args ? input.args : {};
    _prompt2 = (targetArgs?.prompt ?? "").trim().toLowerCase();
    if (typeof targetArgs?.prompt === "string") setActiveJobFromTaskPrompt(targetArgs.prompt);
    const _firstWord2 = _prompt2.split(/\s+/)[0];
    const BASE_EXPLORATORY = /* @__PURE__ */ new Set(["check", "find", "list", "search", "does", "verify", "look", "count", "show", "get", "read", "grep", "scan", "detect", "inspect"]);
    const LEARNED_EXPLORATORY = getLearnedExploratoryWords();
    const EXPLORATORY = /* @__PURE__ */ new Set([...BASE_EXPLORATORY, ...LEARNED_EXPLORATORY]);
    const _exploratoryTarget = EXPLORATORY.has(_firstWord2) ? TRINITY_CHEAP : null;
    const _tierTarget = currentTier === "high" && TRINITY_MEDIUM && TRINITY_MEDIUM !== currentModel ? TRINITY_MEDIUM : TRINITY_CHEAP && TRINITY_CHEAP !== currentModel ? TRINITY_CHEAP : null;
    let _target = _exploratoryTarget ?? _tierTarget;
    const stressScore = latestUserIntent ? scoreStress(latestUserIntent) : 0;
    const apiRoute = await remoteCall("routeModel", [_prompt2, currentTier, TRINITY_CHEAP, TRINITY_MEDIUM, LEARNED_EXPLORATORY, stressScore], null);
    if (apiRoute?.target) {
      _target = apiRoute.target;
    } else if (_target === TRINITY_CHEAP && TRINITY_MEDIUM) {
      if (stressScore > 0.5) {
        _target = TRINITY_MEDIUM;
        console.error(`[vibeOS] \u{1F9D8} Stress ${stressScore.toFixed(2)} \u2192 preserving medium tier for Task quality`);
      }
    }
    if (ML_ENABLED) {
      try {
        const mlDifficulty = computeDifficulty(_prompt2);
        const mlHash = hashQuery(_prompt2);
        const mlGraphPrediction = predictBestModel(_mlGraph, _firstWord2, currentTier);
        if (mlDifficulty.confidence >= ML_CONFIDENCE_THRESHOLD && mlDifficulty.level !== "moderate") {
          const mlTarget = mlDifficulty.suggestedTier === "cheap" ? TRINITY_CHEAP : mlDifficulty.suggestedTier === "medium" ? TRINITY_MEDIUM : null;
          if (mlTarget && mlTarget !== currentModel) {
            const tierRank = { budget: 0, cheap: 1, mid: 2, medium: 2, high: 3, brain: 3 };
            const mlRank = tierRank[mlDifficulty.suggestedTier] || 0;
            const curRank = _target ? tierRank[classify(_target)] || 0 : 0;
            if (!_target) {
              _target = mlTarget;
              console.error(`[vibeOS] \u{1F9E0} ML difficulty: ${mlDifficulty.level} (score ${mlDifficulty.score.toFixed(2)}, conf ${mlDifficulty.confidence.toFixed(2)}) \u2192 ${mlTarget}`);
            } else if (mlRank > curRank && mlDifficulty.confidence >= 0.75) {
              _target = mlTarget;
              console.error(`[vibeOS] \u{1F9E0} ML upgrade: ${mlDifficulty.level} (score ${mlDifficulty.score.toFixed(2)}, conf ${mlDifficulty.confidence.toFixed(2)}) \u2192 ${mlTarget}`);
            }
          }
        }
        if (mlGraphPrediction && mlGraphPrediction !== currentModel) {
          const graphNode = _mlGraph.nodes[_firstWord2];
          if (graphNode && graphNode.count >= 3) {
            if (!_target) {
              _target = mlGraphPrediction;
              console.error(`[vibeOS] \u{1F578} ML graph: ${_firstWord2} \u2192 ${mlGraphPrediction} (${graphNode.count} samples)`);
            }
          }
        }
        if (_target) {
          const _mlTier = classify(_target) === "budget" ? "cheap" : classify(_target) === "mid" ? "medium" : classify(_target);
          addRouteEdge(_mlGraph, _firstWord2, _target, _mlTier, true);
        }
      } catch (mlErr) {
        console.error(`[vibeOS] ML router error: ${mlErr.message}`);
      }
    }
    if (_target) noteTaskRoutingLearning(_firstWord2, _target, _exploratoryTarget ? "exploratory" : `tier:${currentTier}`);
    if (_target && targetArgs?.model !== _target) {
      const _reason = _exploratoryTarget ? `exploratory ('${_firstWord2}')` : `tier=${currentTier}`;
      const _setModel = (obj) => {
        if (!obj || typeof obj !== "object") return;
        obj.model = _target;
        obj.modelID = _target;
        obj.modelId = _target;
      };
      _setModel(targetArgs);
      _setModel(args);
      _setModel(inArgs);
      try {
        const selNow = loadSelection();
        const desiredSlot = _target === TRINITY_CHEAP ? "cheap" : _target === TRINITY_MEDIUM ? "medium" : null;
        if (selNow.delegation_enforce && currentTier === "high" && desiredSlot && selNow.active_slot !== desiredSlot) {
          taskSlotRestore = selNow.active_slot || "brain";
          const switched = applySlot(desiredSlot);
          if (switched?.ok) {
            setCurrentModel(switched.ocModel);
            setCurrentTier(classify(switched.ocModel));
            console.error(`[vibeOS] \u{1F501} task workaround: switched global slot ${taskSlotRestore} \u2192 ${desiredSlot}`);
          } else {
            taskSlotRestore = null;
          }
        }
      } catch {
      }
      console.error(`[vibeOS] \u{1F500} Task \u2192 ${_target} (${_reason}, orchestrator: ${currentModel})`);
    }
  }
  if (FREE.has(t)) return;
  if (isModelFree(currentModel)) return;
  const _brainCost = modelCostPerTurn(currentModel);
  const _workerModel = TRINITY_CHEAP || TRINITY_MEDIUM || null;
  const _workerCost = _workerModel ? modelCostPerTurn(_workerModel) ?? 0 : 0;
  const _rawEdit = _brainCost !== null ? Math.max(0, _brainCost - _workerCost) : SAVE_EST.WRITE_EDIT;
  const _estEdit = Math.max(_rawEdit, SAVE_EST.WRITE_EDIT * 0.1);
  const _estOpus = _brainCost !== null ? Math.max(_brainCost, _estEdit) : SAVE_EST.OPUS_DISABLE;
  const _estC7 = _brainCost !== null ? Math.max(_brainCost, SAVE_EST.CONTEXT7) : SAVE_EST.CONTEXT7;
  const _tierWord = currentTier === "high" ? "Brain" : currentTier === "mid" ? "Medium" : "Budget";
  const _firstWord = extractFirstWordFromArgs(t, args || inArgs);
  if (_credit < 40) {
    const total = recordSaving(t, "credit<40% high-tier", _estOpus, { firstWord: _firstWord });
    const trend = trendDisplay(readLifetimeSavings().sesTrend);
    const msg = `\u26A0 [vibeOS] Credit: ${_credit}% \u2014 switching to medium saves ~$${_estOpus.toFixed(3)}/turn. Run \`trinity medium\`.`;
    if (shouldLogWarn(`${t}|credit|${_tierWord}`)) console.error(`[vibeOS] [delegation] ${msg}`);
    pendingUiNote = msg;
    return;
  }
  if (WARN_ON_DIRECT.has(String(t || "").toLowerCase())) {
    const sel = loadSelection();
    console.error(`[vibeOS] [enforce-debug] tool=${t} tier=${currentTier} enforce=${sel?.delegation_enforce} argsType=${typeof args} argsExists=${!!args}`);
    const tLower = String(t || "").toLowerCase();
    if (sel.delegation_enforce && currentTier === "high" && args && typeof args === "object") {
      const actualArgs = args || output && output.args || {};
      const originalPath = actualArgs.filePath || actualArgs.file_path || "";
      const basename2 = originalPath.split("/").pop() || "blocked";
      const apiResult = await remoteCall("delegateCheck", [tLower, currentTier, currentModel, _prompt2], () => ({
        blocked: true,
        savings: _estEdit
      }));
      const isBlocked = apiResult?.blocked !== false;
      const savings = apiResult?.savings ?? _estEdit;
      if (isBlocked) {
        if (tLower === "write") {
          actualArgs.filePath = `/tmp/vibeos-enforcement-blocked-${basename2}`;
          if (actualArgs.file_path !== void 0) actualArgs.file_path = actualArgs.filePath;
        } else if (tLower === "edit" || tLower === "notebookedit") {
          actualArgs.oldString = `__THE_SAVER_ENFORCEMENT_BLOCK_${Date.now()}__`;
        }
        const total2 = recordSaving(t, "delegation enforced", savings, { firstWord: _firstWord });
        pendingUiNote = `\u{1F6AB} Direct ${t} blocked on Brain tier \u2192 delegate via Task or run \`trinity medium\`.`;
        enforcementBlocked = true;
        if (shouldLogWarn(`${t}|enforced|${_tierWord}`)) console.error(`[vibeOS] [enforcement] BLOCKED direct ${t} on high tier \u2192 delegate via Task`);
        return;
      }
    }
    const total = recordSaving(t, "direct edit", _estEdit, { firstWord: _firstWord });
    const msg = `[vibeOS] ${_tierWord} tier direct ${t} \u2014 save ~$${_estEdit.toFixed(3)} by delegating to Task. Run \`trinity medium\`.`;
    if (shouldLogWarn(`${t}|direct|${_tierWord}`)) console.error(`[vibeOS] [delegation] ${msg}`);
    pendingUiNote = msg;
    return;
  }
  if (SOFT_QUOTA.has(t)) {
    if (t !== "bash") {
      const target = args?.url || args?.query || "";
      if (isDocsTarget(target) && !context7Seen.has(target)) {
        context7Seen.add(target);
        if (detectContext7()) {
          const total = recordSaving(t, "docs-target without context7", _estC7, { firstWord: _firstWord });
          console.error(`[vibeOS] [cost policy] Context7 available \u2014 prefer over webfetch for docs lookups (~$0.06/turn saved).`);
        } else {
          const missed = recordMissedContext7(_estC7);
          if (!existsSync(CONTEXT7_INSTALL_FLAG)) {
            try {
              mkdirSync(dirname(CONTEXT7_INSTALL_FLAG), { recursive: true });
              writeFileSync(CONTEXT7_INSTALL_FLAG, "");
            } catch {
            }
            console.error(`[vibeOS] \u{1F4A1} Install context7 MCP to save ~$0.06/turn on docs: \`claude mcp add context7 npx @upstash/context7-mcp\``);
          } else if (!context7AlertedThisSession) {
            context7AlertedThisSession = true;
            console.error(`[vibeOS] \u{1F4B8} context7 not installed \u2014 missed ~$${(missed ?? 0).toFixed(2)} savings this session.`);
          }
        }
      }
    }
    softQuotaCounts[t] = (softQuotaCounts[t] ?? 0) + 1;
    const n = softQuotaCounts[t];
    if (n === SOFT_QUOTA_LIMIT + 1) {
      const total = recordSaving(t, `soft quota exceeded (limit ${SOFT_QUOTA_LIMIT})`, SAVE_EST.SOFT_QUOTA);
      console.error(`[vibeOS] Bash usage high (${n}/${SOFT_QUOTA_LIMIT}) \u2014 delegate to Task subagent.`);
    } else if (n <= SOFT_QUOTA_LIMIT) {
      console.error(`[vibeOS] ${t} ${n}/${SOFT_QUOTA_LIMIT}`);
    }
    return;
  }
};
const onToolExecuteAfter = async (input, output) => {
  if (!loadSelection().enabled) return;
  _refreshModel(projectDirectory);
  let _footerText = "";
  try {
    const { ltTasks, ltCache, ltCost, sesTrend, sesModelTurns } = readLifetimeSavings();
    const ltTotal = ltTasks + ltCache;
    const trendIcon = sesTrend === "down" ? "\u2193" : sesTrend === "up" ? "\u2191" : "\u2192";
    const selNow = loadSelection();
    const tags = [`[${shortModelName(currentModel)}]`];
    const bbMode = resolveEnforcementMode();
    if (bbMode === "relaxed") {
      tags.push("[Q&A]");
    } else {
      if (selNow.delegation_enforce) tags.push("[ENF ON]");
      if (selNow.flow_enforce) tags.push("[FLOW ON]");
      if (selNow.tdd_enforce) tags.push("[TDD ON]");
      if (bbMode === "strict") tags.push("[STRICT]");
    }
    if (_modelLocked) tags.push("[LOCK ON]");
    const workerModel = currentTier === "high" && TRINITY_MEDIUM ? TRINITY_MEDIUM : TRINITY_CHEAP;
    const totalTurns = (sesModelTurns?.brain || 0) + (sesModelTurns?.worker || 0);
    if (totalTurns > 0 && workerModel && workerModel !== currentModel) {
      const brainPct = Math.round(sesModelTurns.brain / totalTurns * 100);
      tags[0] = `[${shortModelName(currentModel)} ${brainPct}% > ${shortModelName(workerModel)} ${100 - brainPct}%]`;
    }
    const statusLine = tags.join(" ");
    let stressTag = "";
    if (latestUserIntent) {
      const ss = scoreStress(latestUserIntent);
      if (ss > 0.1) {
        const label = ss > 0.7 ? "high" : ss > 0.4 ? "elevated" : "calm";
        stressTag = ` stress:${label}`;
      }
    }
    if (ltTotal > 0) {
      _footerText = `vibeOS: ${formatUsd(ltTotal)} saved ${trendIcon} | ${statusLine}${stressTag}

`;
    } else {
      _footerText = `${statusLine}${stressTag}

`;
    }
    output.title = _footerText.trim();
    if (typeof output?.output === "string") output.output = _footerText + output.output;
    else if (typeof output?.result === "string") output.result = _footerText + output.result;
    else if (typeof output?.text === "string") output.text = _footerText + output.text;
    else if (typeof output?.content === "string") output.content = _footerText + output.content;
    else output.output = _footerText;
    _autoReportCount = (_autoReportCount || 0) + 1;
    if (_autoReportCount % 5 === 0 && ltTotal > 0) {
      saveReport({
        type: "session",
        summary: `Session cost: $${formatUsd(ltCost)} | cache saved: $${formatUsd(ltCache)} | delegation saved: $${formatUsd(ltTasks)}`,
        metrics: { sessionId: _OC_SID, sessionCost: ltCost, cacheSavings: ltCache, delegationSavingsUsd: ltTasks, model: currentModel, slot: selNow.active_slot || "unknown" },
        tags: ["auto", "cost"]
      });
    }
  } catch {
  }
  const t = input?.tool ?? "";
  if (t === "trinity") {
    const trinityArgs = input?.args || {};
    const trinityAction = trinityArgs?.action || trinityArgs?.todo || "";
    if (trinityAction === "todo") {
      try {
        const flowTodoFilePath = require("path").join(require("os").homedir(), ".claude/flow-todo-queue.jsonl");
        let todoLines = [];
        if (require("fs").existsSync(flowTodoFilePath)) {
          const raw2 = require("fs").readFileSync(flowTodoFilePath, "utf-8").trim();
          todoLines = raw2 ? raw2.split("\n").filter(Boolean) : [];
        }
        let todoList = todoLines.map((l, i) => {
          try {
            const p = JSON.parse(l);
            return "  " + (i + 1) + ". " + (p.text || l);
          } catch {
            return "  " + (i + 1) + ". " + l;
          }
        }).join("\n");
        const todoNote = "[vibeOS] Flow TODO Queue: " + todoLines.length + " item(s)\n" + (todoList || "  (no pending TODOs)");
        if (typeof output?.text === "string")
          output.text = todoNote + "\n\n" + output.text;
        else if (typeof output?.result === "string")
          output.result = todoNote + "\n\n" + output.result;
      } catch (e) {
        console.error("[vibeOS] trinity todo error:", e);
      }
    }
    return;
  }
  if ((t === "task" || t === "bash" || t === "edit" || t === "write") && !_mlSavePending) {
    setMlSavePending(true);
    setTimeout(() => {
      saveMLState();
      setMlSavePending(false);
    }, 5e3);
  }
  if (t === "task") {
    const m = input?.args?.model;
    if (m && typeof output?.title === "string") {
      const label = modelToSlotLabel(m);
      output.title = output.title.replace(/\[agent\]|\[general\]/gi, label);
      if (!output.title.includes(label)) output.title = `${output.title} ${label}`;
    }
  }
  if (t === "task") {
    const quality = scoreTaskQuality(output?.result || output?.text || "", input?.args?.prompt || "");
    try {
      appendFileSync(SAVINGS_LEDGER_FILE, JSON.stringify({
        at: (/* @__PURE__ */ new Date()).toISOString(),
        kind: "quality",
        score: quality,
        tool: t,
        sid: _OC_SID,
        v: 2
      }) + "\n");
    } catch {
    }
    updateState((s) => {
      s.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" };
      s.lifetime.quality_total_score = (s.lifetime.quality_total_score || 0) + quality;
      s.lifetime.quality_total_count = (s.lifetime.quality_total_count || 0) + 1;
      s.lifetime.last_updated = (/* @__PURE__ */ new Date()).toISOString();
      return s;
    });
  }
  if (pendingUiNote) {
    if (enforcementBlocked) {
      if (typeof output?.result === "string") output.result = pendingUiNote;
      else if (typeof output?.text === "string") output.text = pendingUiNote;
      else if (typeof output?.content === "string") output.content = pendingUiNote;
      else output.result = pendingUiNote;
    } else {
      const note = `

${pendingUiNote}`;
      if (typeof output?.result === "string") output.result += note;
      else if (typeof output?.text === "string") output.text += note;
      else if (typeof output?.content === "string") output.content += note;
      else output.result = pendingUiNote;
    }
    pendingUiNote = null;
  }
  if (t === "task" && taskSlotRestore) {
    try {
      const back = applySlot(taskSlotRestore);
      if (back?.ok) {
        setCurrentModel(back.ocModel);
        setCurrentTier(classify(back.ocModel));
        console.error(`[vibeOS] \u{1F501} task workaround: restored global slot \u2192 ${taskSlotRestore}`);
      }
    } catch {
    }
    taskSlotRestore = null;
  }
  if (enforcementBlocked) {
    enforcementBlocked = false;
    return;
  }
  observeToolPattern(t, input, output, projectDirectory);
  if (t === "task") {
    const outputText = output?.result ?? output?.text ?? output?.content ?? "";
    if (typeof outputText === "string" && outputText.length > 0) {
      const TASK_FILE_RE = /((?:\.?[\w@][\w.\-]*\/)+[\w.\-]+\.(?:py|js|ts|mjs|tsx|jsx|cjs|mts|sh|go|rs|rb|java|kt))/gi;
      const sel = loadSelection();
      const explicitTestIntent = isUserAskingForTests(latestUserIntent);
      const seen = /* @__PURE__ */ new Set();
      let match;
      while ((match = TASK_FILE_RE.exec(outputText)) !== null) {
        const fp = match[1];
        if (seen.has(fp)) continue;
        seen.add(fp);
        const isTestPath = /(^|\/)(tests?|spec)\//i.test(fp) || /\.(test|spec)\./i.test(fp);
        if (sel.tdd_enforce && !isTestPath) {
          const createdPath = enforceTestFile(fp);
          if (createdPath) {
            const ext = createdPath.split(".").pop();
            const fileName = createdPath.split("/").pop();
            const enforceNote = "\n\n[test-enforced] Created skeleton at " + createdPath + "\n  NEXT: 1) Open " + fileName + "  2) Replace TODO/FIXME markers with real assertions  3) Run `npx vitest run " + createdPath + "` (or language-equivalent)  4) Confirm tests pass";
            if (typeof output?.text === "string") output.text += enforceNote;
            else if (typeof output?.result === "string") output.result += enforceNote;
          }
        }
      }
    }
  }
  if (t === "write" || t === "edit" || t === "multiedit") {
    const fp = input?.args?.filePath || input?.args?.file_path || input?.args?.path || "";
    const reminder = buildTestReminder(fp);
    if (reminder) {
      const note = `

[test-reminder] ${reminder}`;
      if (typeof output?.text === "string") output.text += note;
      else if (typeof output?.result === "string") output.result += note;
      else console.error(`[vibeOS] ${reminder}`);
    }
    const sel = loadSelection();
    const explicitTestIntent = isUserAskingForTests(latestUserIntent);
    const isTestPath = /(^|\/)(tests?|spec)\//i.test(fp) || /\.(test|spec)\./i.test(fp);
    if (sel.tdd_enforce && !isTestPath) {
      const createdPath = enforceTestFile(fp);
      if (createdPath) {
        const ext = createdPath.split(".").pop();
        const fileName = createdPath.split("/").pop();
        const enforceNote = `

[test-enforced] Created skeleton at ${createdPath}
  NEXT: 1) Open ${fileName}  2) Replace TODO/FIXME markers with real assertions  3) Run \`npx vitest run ${createdPath}\` (or language-equivalent)  4) Confirm tests pass`;
        if (typeof output?.text === "string") output.text += enforceNote;
        else if (typeof output?.result === "string") output.result += enforceNote;
      }
    }
    if (t === "edit" || t === "write") {
      const testExtRe = /\.(test|spec)\./i;
      if (testExtRe.test(fp)) {
        try {
          updateState((state) => {
            state.lifetime ??= { warn_count: 0, total_savings_usd: 0, last_updated: "" };
            state.lifetime.tdd_followup_completions = (state.lifetime.tdd_followup_completions || 0) + 1;
            state.lifetime.last_updated = (/* @__PURE__ */ new Date()).toISOString();
            return state;
          });
        } catch {
        }
      }
    }
    {
      const fp2 = input?.args?.filePath || input?.args?.file_path || input?.args?.path || "";
      const guardRe = /(?:^|\/)(AGENTS|README)\.md$/i;
      if (guardRe.test(fp2)) {
        const guardIcons = { flag: "!", warn: "!!", hint: "_" };
        const guardIcon = guardIcons.flag || "!";
        const fn = basename(fp2);
        console.error(`[flow-enforcer] ${guardIcon} [guard] ${fn}: protected project doc modified \u2014 verify user intent`);
      }
    }
    if (sel.flow_enabled) {
      const toolName = t === "edit" ? "edit" : "write";
      const filePath = input?.args?.filePath || input?.args?.file_path || input?.args?.path || "";
      const content = t === "edit" ? input?.args?.newString || "" : input?.args?.content || "";
      const flowHits = checkFlowRules({ tool: toolName, filePath, content });
      for (const h of flowHits) {
        if (h.deduped) continue;
        const icon = h.severity === "warn" ? "\u26A0" : "\u{1F4A1}";
        console.error(`[flow-enforcer] ${icon} [${h.severity}] ${h.id}: ${h.description} \u2014 ${filePath}`);
      }
      if (sel.flow_enforce) {
        const { recordFlowTodo: recordFlowTodo2 } = await import("../../vibeOS-lib/flow-enforcer.js");
        for (const h of flowHits) {
          if (h.id === "todo-comment" && !h.deduped) {
            recordFlowTodo2({ filePath, content });
          }
        }
      }
      let todoCount = 0;
      for (const h of flowHits) {
        if (h.id === "todo-comment" && !h.deduped) todoCount++;
      }
      if (todoCount > 0) {
        const todoPushNote = "[todo-push] Auto-extracted " + todoCount + " TODO(s) from " + filePath + ". Call todowrite to add them to your task list.";
        if (typeof output?.text === "string")
          output.text += "\n\n" + todoPushNote;
        else if (typeof output?.result === "string")
          output.result += "\n\n" + todoPushNote;
      }
    }
  }
  if (t !== "webfetch") {
    applyDecadence();
    return;
  }
  const raw = output?.result ?? output?.text ?? output?.content ?? output?.data;
  if (!raw || typeof raw !== "string") {
    applyDecadence();
    return;
  }
  const processed = compressText(raw);
  if (processed !== raw) {
    if (output.result !== void 0) output.result = processed;
    else if (output.text !== void 0) output.text = processed;
    else if (output.content !== void 0) output.content = processed;
    else if (output.data !== void 0) output.data = processed;
  }
  applyDecadence();
};
export {
  onToolExecuteAfter,
  onToolExecuteBefore,
  setToolDirectory
};

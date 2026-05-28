// @ts-nocheck
import { MODE_DELTAS, autoSelectMode } from "./meta-controller.js";
import { PivotCache } from "./pivot-cache.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";


const __dirname = dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = process.env.VIBEOS_VIBEMAX_MODEL_PATH || resolve(__dirname, "..", "..", "..", "data", "vibemax-model.json");

const PRIORITY = { budget: 0, audit: 1, speed: 2, longrun: 3, quality: 4 };

function fallback(sr, text) {
  if (sr === "LOOPING") return "speed";
  const t = String(text || "").toLowerCase();
  if (sr === "INIT" && t.length <= 42 && !/[\.\/\\]/.test(t)) return "budget";
  return "quality";
}

// PRNG
function rng(seed) {
  let s = seed | 0;
  return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

function gini(samples, label) {
  return 1 - samples.filter(s => s.label === label).length ** 2 / samples.length ** 2;
}

function buildTree(samples, classes, depth, maxDepth, minLeaf, rngFn) {
  if (samples.length <= minLeaf || depth >= maxDepth || new Set(samples.map(s => s.label)).size === 1) {
    const counts = Object.fromEntries(classes.map(c => [c, 0]));
    for (const s of samples) counts[s.label]++;
    const total = samples.length || 1;
    return { prediction: classes.reduce((a, b) => counts[a] > counts[b] ? a : b), probs: classes.map(c => counts[c] / total) };
  }
  const nFeats = samples[0]?.features?.length || 1;
  const featSample = Math.max(2, Math.min(nFeats, Math.floor(Math.sqrt(nFeats)) + 1));
  const cols = new Set();
  while (cols.size < featSample) cols.add(Math.floor(rngFn() * nFeats));
  let bestG = 0, bestC = -1, bestV = 0;
  for (const c of cols) {
    const vals = [...new Set(samples.map(s => s.features[c]))].sort((a, b) => a - b);
    for (const v of vals) {
      const l = samples.filter(s => s.features[c] <= v);
      const r = samples.filter(s => s.features[c] > v);
      if (l.length < minLeaf || r.length < minLeaf) continue;
      const gParent = classes.reduce((sum, cl) => sum + gini(samples, cl), 0);
      const gChild = (l.length / samples.length) * classes.reduce((sum, cl) => sum + gini(l, cl), 0) + (r.length / samples.length) * classes.reduce((sum, cl) => sum + gini(r, cl), 0);
      const gain = gParent - gChild;
      if (gain > bestG) { bestG = gain; bestC = c; bestV = v; }
    }
  }
  if (bestC === -1 || bestG <= 0) {
    const counts = Object.fromEntries(classes.map(c => [c, 0]));
    for (const s of samples) counts[s.label]++;
    const total = samples.length || 1;
    return { prediction: classes.reduce((a, b) => counts[a] > counts[b] ? a : b), probs: classes.map(c => counts[c] / total) };
  }
  return { column: bestC, value: bestV, left: buildTree(samples.filter(s => s.features[bestC] <= bestV), classes, depth + 1, maxDepth, minLeaf, rngFn), right: buildTree(samples.filter(s => s.features[bestC] > bestV), classes, depth + 1, maxDepth, minLeaf, rngFn) };
}

function predictTree(tree, features) {
  if (tree.prediction) return tree;
  return features[tree.column] <= tree.value ? predictTree(tree.left, features) : predictTree(tree.right, features);
}

const VIBEMAX_CFG = { tier: "medium", thinking: "full", tdd: "quality", flow: "strict", enforcement: "strict", wbp: "normal", c7: "required", kp: [3, 6], tc: 0.3, amode: "plan" };
const BUDGET_CFG = { tier: "cheap", thinking: "off", tdd: "normal", flow: "audit", enforcement: "relaxed", wbp: "minimal", c7: "skippable", kp: [1, 3], tc: 0.1, amode: "build" };
const VIBEMAX_MAP = { quality: "optimized", longrun: "optimized", audit: "optimized", speed: "budget", budget: "budget" };

// PivotCache instance
let pivotCache = null;
function getPivotCache() {
  if (!pivotCache) pivotCache = new PivotCache();
  return pivotCache;
}
let prevMessage = "";
export function resetVibeMaXPipeline() {
  prevMessage = "";
  if (pivotCache) pivotCache.resetSequence();
}

export function vibemaxSelectMode(input = {}) {
  const stress = Number(input.stress_multiplier || input.stress || 0);
  const pm = autoSelectMode(input.sub_regime, stress) || fallback(input.sub_regime, input.user_text || input.prompt || "");
  const vm = VIBEMAX_MAP[pm] || "optimized";
  if (vm === "budget") {
    return { mode: "budget", source: "vibemax", source_prediction: pm, confidence: 0, auto_result: null, ...BUDGET_CFG, cost: 0.1 };
  }
  const cfg = loadVibeMaXModel()?.config || { think: "full", wbp: "normal", kp: [3, 6] };
  const text = input.user_text || input.prompt || "";

  // PivotCache: detect if returning to a cached workflow
  const pc = getPivotCache();
  const tokens = pc.tokenize(text);
  const pivotBack = text && tokens.size > 0 ? pc.detectPivotBack(tokens, 0.5) : { matchedId: null, confidence: 0, reason: "no_text" };
  const isPivotBack = pivotBack.matchedId !== null;
  const think = isPivotBack ? "brief" : (cfg.think || "full");
  const injection = isPivotBack ? pc.buildInjection(pivotBack.matchedId) : "";

  return {
    mode: "vibemax", source: "vibemax", source_prediction: pm, confidence: auto.confidence || 0,
    auto_result: null, tier: "medium", thinking: think, tdd: "quality", flow: "strict",
    enforcement: "strict", wbp: cfg.wbp || "normal", c7: "required", kp: cfg.kp || [3, 6],
    tc: 0.3, amode: "plan", cost: 0.3,
    pivot: isPivotBack ? { matchedId: pivotBack.matchedId, confidence: pivotBack.confidence, injection } : null,
  };
}

export function vibemaxPipeline(input = {}) {
  const text = input.user_text || input.prompt || "";
  const pc = getPivotCache();

  // Detect pivot from previous message
  const isPivot = prevMessage && text ? pc.detectPivot(text, prevMessage) : { isPivot: false, similarity: 1 };

  // If pivot: snapshot previous workflow before switching
  if (isPivot.isPivot && prevMessage) {
    const prevTokens = pc.tokenize(prevMessage);
    const prevId = "wf-" + Date.now();
    pc.snapshot(prevId, {
      tokens: [...prevTokens],
      intent: prevMessage.substring(0, 60),
      decisions: ["previous workflow captured at pivot point"],
      files: [], code_snippets: [], blockers: [],
    });
  }

  const result = vibemaxSelectMode(input);

  if (text) prevMessage = text;

  return {
    ...result,
    pivot_detected: isPivot.isPivot || false,
    pivot_similarity: isPivot.similarity || 1,
    pivot_back: result.pivot?.matchedId || null,
  };
}

export function predictVibeMaX(input = {}) {
  const r = vibemaxSelectMode(input);
  return { label: r.mode, confidence: r.confidence, source: "vibemax", source_prediction: r.source_prediction, pivot_back: r.pivot?.matchedId || null };
}

function extractVibeMaXFeatures(text, sr) {
  const t = (text || "").toLowerCase();
  const words = t.split(/\s+/).filter(Boolean);
  const f = {
    length: text.length / 5000,
    word_count: words.length / 500,
    sentence_count: (text.split(/[.!?]+/).filter(s => s.trim()).length) / 50,
    question_ratio: (text.match(/\?/g) || []).length / Math.max(text.split(/[.!?]+/).length, 1),
    code_blocks: (text.match(/```/g) || []).length / 10,
    urgency: /urgent|asap|immediately|critical|broken|failing|crash|error|bug/i.test(text) ? 1.0 : 0.0,
    complexity: /complex|difficult|hard|confusing|trick|subtle|nuance/i.test(text) ? 1.0 : 0.0,
    instruction_density: /do not|must|should|always|never|critical/i.test(text) ? 1.0 : /please|could you|maybe|perhaps/i.test(text) ? 0.3 : 0.6,
  };
  return {
    ...Object.fromEntries(Object.entries(f).filter(([_, v]) => typeof v === "number")),
    word_count: words.length,
    has_question: t.includes("?") ? 1 : 0,
    has_debug: /debug|fix|broken|error|bug/.test(t) ? 1 : 0,
    has_explain: /explain|what|how|why|compare|review/.test(t) ? 1 : 0,
    has_refactor: /refactor|optimize|clean|improve/.test(t) ? 1 : 0,
    has_short: words.length <= 3 ? 1 : 0,
  };
}

function extractFeatureVector(text, sr) {
  const feats = extractVibeMaXFeatures(text, sr);
  return Object.values(feats).filter(v => typeof v === "number" && Number.isFinite(v));
}

export function trainVibeMaXModelFromTelemetry(telemetryPath) {
  const raw = readFileSync(telemetryPath, "utf-8").trim();
  const entries = raw.split("\n").filter(l => l.trim()).map(l => JSON.parse(l));
  const fbMode = { audit: "optimized", budget: "budget", quality: "optimized", speed: "budget", longrun: "optimized" };
  const classes = ["optimized", "budget"];
  const samples = [];

  for (const e of entries) {
    const t = e.telemetry || {};
    const text = t.input?.user_text || e.text || "";
    const sr = t.signals?.sub_regime || t.input?.sub_regime || "INIT";
    const mode = t.selection?.optimization_mode || t.control_vector?.optimization_mode || t.mode || "";
    if (!text || text.length < 2) continue;
    const target = fbMode[mode] || "optimized";
    const features = extractFeatureVector(text, sr);
    if (features.length > 0) samples.push({ features, label: target, text, sr, original_mode: mode });
  }

  if (samples.length < 2) {
    const boot = [
      // Technical / coding (16)
      { text: "hi", sr: "INIT", label: "budget" },
      { text: "what time is it", sr: "INIT", label: "budget" },
      { text: "show current status", sr: "INIT", label: "budget" },
      { text: "just give me quick answer", sr: "INIT", label: "budget" },
      { text: "review error handling", sr: "EXPLORING", label: "optimized" },
      { text: "this is broken fix it immediately", sr: "REFINING", label: "optimized" },
      { text: "help me debug this failing test", sr: "REFINING", label: "optimized" },
      { text: "we are repeating the same solution", sr: "LOOPING", label: "budget" },
      { text: "I need complete investigation with reasoning", sr: "RESEARCH", label: "optimized" },
      { text: "research the right documentation", sr: "RESEARCH", label: "optimized" },
      { text: "implement new feature with comprehensive tests", sr: "REFINING", label: "optimized" },
      { text: "lets wrap up and ship final change", sr: "CONVERGING", label: "optimized" },
      { text: "compare Redis vs Memcached performance", sr: "EXPLORING", label: "optimized" },
      { text: "search for all TODO comments", sr: "EXPLORING", label: "optimized" },
      { text: "whats the next step", sr: "INIT", label: "budget" },
      { text: "why does this keep looping", sr: "LOOPING", label: "budget" },
      // Non-technical (20)
      { text: "summarize this article", sr: "INIT", label: "budget" },
      { text: "tell me a joke", sr: "INIT", label: "budget" },
      { text: "translate hello to spanish", sr: "INIT", label: "budget" },
      { text: "whats the weather like", sr: "INIT", label: "budget" },
      { text: "write a quick email", sr: "INIT", label: "budget" },
      { text: "draft a meeting agenda", sr: "INIT", label: "audit" },
      { text: "analyze this spreadsheet data and find outliers", sr: "EXPLORING", label: "optimized" },
      { text: "compare these two products for my purchase decision", sr: "EXPLORING", label: "optimized" },
      { text: "review this contract for legal issues", sr: "EXPLORING", label: "optimized" },
      { text: "help me brainstorm marketing ideas", sr: "DIVERGENT", label: "audit" },
      { text: "edit this essay for grammar and clarity", sr: "REFINING", label: "audit" },
      { text: "improve the structure of this presentation", sr: "REFINING", label: "optimized" },
      { text: "proofread this resume and suggest improvements", sr: "REFINING", label: "optimized" },
      { text: "create a budget spreadsheet for my startup", sr: "REFINING", label: "optimized" },
      { text: "write a detailed business report on market trends", sr: "RESEARCH", label: "optimized" },
      { text: "research competitors for my business idea", sr: "RESEARCH", label: "optimized" },
      { text: "study this financial model and verify projections", sr: "RESEARCH", label: "optimized" },
      { text: "generate a social media content calendar", sr: "REFINING", label: "optimized" },
      { text: "we keep going in circles on this decision", sr: "LOOPING", label: "budget" },
      { text: "finalize the press release", sr: "CONVERGING", label: "optimized" },
    ];
    for (const b of boot) {
      const features = extractFeatureVector(b.text, b.sr);
      if (features.length > 0) samples.push({ features, label: b.label, text: b.text, sr: b.sr, original_mode: b.label });
    }
  }

  const treeCount = 29, maxDepth = 5, minLeaf = 2;
  const rngFn = rng(42);
  const trees = [];
  for (let i = 0; i < treeCount; i++) {
    const bag = [];
    for (let j = 0; j < samples.length; j++) bag.push(samples[Math.floor(rngFn() * samples.length)]);
    trees.push(buildTree(bag, classes, 0, maxDepth, minLeaf, rngFn));
  }

  let correct = 0;
  for (const s of samples) {
    const votes = {};
    for (const t of trees) { const r = predictTree(t, s.features); votes[r.prediction] = (votes[r.prediction] || 0) + 1; }
    const pred = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] || classes[0];
    if (pred === s.label) correct++;
  }

  const model = { trees, classes, trained_at: new Date().toISOString(), samples: samples.length, metrics: { accuracy: correct / Math.max(samples.length, 1), total_samples: samples.length }, config: { think: "full", wbp: "normal", kp: [3, 6] } };
  saveVibeMaXModel(model);
  return model;
}

export function loadVibeMaXModel() {
  if (existsSync(MODEL_PATH)) return JSON.parse(readFileSync(MODEL_PATH, "utf-8"));
  return null;
}

export function saveVibeMaXModel(model) {
  mkdirSync(dirname(MODEL_PATH), { recursive: true });
  writeFileSync(MODEL_PATH, JSON.stringify(model, null, 2) + "\n", "utf-8");
}

export function getVibeMaXModelMeta() {
  const m = loadVibeMaXModel();
  if (!m) return { available: false, path: MODEL_PATH, message: "not trained" };
  return { available: true, path: MODEL_PATH, trained_at: m.trained_at, accuracy: m.metrics?.accuracy, samples: m.samples, trees: m.trees?.length, classes: m.classes };
}

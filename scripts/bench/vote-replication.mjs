import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { resolveProviderEndpoint, askDirect } from "../../src/vibeOS-lib/direct-vote.js"

const args = new Map()
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a.startsWith("--")) args.set(a.slice(2), process.argv[i + 1])
}
const ITEMS = args.get("items") || ".bench/items.jsonl"
const OUT = args.get("out") || ".bench/raw.jsonl"
const LIMIT = Number(args.get("limit") || 0)
const CONC = Number(args.get("concurrency") || 4)
const MAXTOK = Number(args.get("max-tokens") || 1024)
const TIMEOUT = Number(args.get("timeout") || 60000)

const MODELS = String(args.get("models") || "").split(",").map((s) => s.trim()).filter(Boolean)
if (!MODELS.length) { console.error("--models required (comma separated provider/model ids)"); process.exit(2) }

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]

function buildPrompt(item) {
  const choices = item.choices.map((c, i) => `${LETTERS[i]}. ${c}`).join("\n")
  return `${item.question}\n${choices}\n\nAnswer with a single letter and nothing else.`
}

function extractLetter(text, nChoices) {
  const t = String(text || "").trim()
  if (!t) return null
  const valid = LETTERS.slice(0, nChoices)
  const boxed = t.match(/\\boxed\{\s*([A-J])\s*\}/i)
  if (boxed && valid.includes(boxed[1].toUpperCase())) return boxed[1].toUpperCase()
  const lead = t.match(/^[^A-Za-z0-9]*([A-J])\b/)
  if (lead && valid.includes(lead[1].toUpperCase())) return lead[1].toUpperCase()
  const tail = t.match(/(?:answer|is)[^A-J]{0,12}([A-J])\b/i)
  if (tail && valid.includes(tail[1].toUpperCase())) return tail[1].toUpperCase()
  for (let i = t.length - 1; i >= 0; i--) {
    const ch = t[i].toUpperCase()
    if (valid.includes(ch) && (i === 0 || !/[A-Za-z]/.test(t[i - 1])) && (i === t.length - 1 || !/[A-Za-z]/.test(t[i + 1]))) return ch
  }
  return null
}

const endpoints = new Map()
for (const id of MODELS) {
  const slash = id.indexOf("/")
  if (slash < 0) { console.error(`bad model id: ${id}`); process.exit(2) }
  const provider = id.slice(0, slash)
  if (!endpoints.has(provider)) {
    const ep = resolveProviderEndpoint(provider)
    if (!ep) { console.error(`no endpoint or key for provider ${provider}`); process.exit(2) }
    endpoints.set(provider, ep)
  }
}

let items = readFileSync(ITEMS, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
if (LIMIT > 0) items = items.slice(0, LIMIT)

mkdirSync(dirname(OUT), { recursive: true })
const rows = []
let done = 0

async function runItem(item) {
  const prompt = buildPrompt(item)
  const per = await Promise.all(MODELS.map(async (id) => {
    const slash = id.indexOf("/")
    const ep = endpoints.get(id.slice(0, slash))
    const modelID = id.slice(slash + 1)
    const t0 = Date.now()
    try {
      const text = await askDirect(ep, modelID, prompt, TIMEOUT, MAXTOK)
      const letter = extractLetter(text, item.choices.length)
      return { model: id, letter, raw: String(text || "").slice(0, 120), ms: Date.now() - t0, error: null }
    } catch (e) {
      return { model: id, letter: null, raw: "", ms: Date.now() - t0, error: String(e?.message || e).slice(0, 120) }
    }
  }))
  const row = { id: item.id, subject: item.subject || null, gold: item.gold, answers: per }
  rows.push(row)
  done++
  if (done % 10 === 0 || done === items.length) process.stderr.write(`\r[vote-bench] ${done}/${items.length}`)
  return row
}

const queue = items.slice()
await Promise.all(Array.from({ length: Math.min(CONC, queue.length) }, async () => {
  while (queue.length) {
    const item = queue.shift()
    if (item) await runItem(item)
  }
}))
process.stderr.write("\n")

writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join("\n") + "\n")
console.log(`wrote ${rows.length} rows to ${OUT}`)

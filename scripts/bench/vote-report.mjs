import { readFileSync } from "node:fs"

const args = new Map()
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i]
  if (a.startsWith("--")) args.set(a.slice(2), process.argv[i + 1])
}
const RAW = args.get("raw") || ".bench/raw.jsonl"
const BRAIN = args.get("brain") || ""

const rows = readFileSync(RAW, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
if (!rows.length) { console.error("no rows"); process.exit(2) }

const models = rows[0].answers.map((a) => a.model)
const voters = models.filter((m) => m !== BRAIN)

function correctOf(row, model) {
  const a = row.answers.find((x) => x.model === model)
  if (!a || a.letter == null) return null
  return a.letter === row.gold
}

function majority(row, pool) {
  const counts = new Map()
  let considered = 0
  for (const m of pool) {
    const a = row.answers.find((x) => x.model === m)
    if (!a || a.letter == null) continue
    considered++
    counts.set(a.letter, (counts.get(a.letter) || 0) + 1)
  }
  if (!considered) return { letter: null, agreement: 0, considered: 0, tied: false }
  let best = null, bestN = 0, tied = false
  for (const [l, n] of counts) {
    if (n > bestN) { best = l; bestN = n; tied = false }
    else if (n === bestN) tied = true
  }
  return { letter: tied ? null : best, agreement: bestN / considered, considered, tied }
}

const pct = (x) => `${(x * 100).toFixed(1)}%`
const n = rows.length

console.log(`items: ${n}\n`)
console.log("model                              acc     answered  unparsed")
const accs = new Map()
for (const m of models) {
  const vals = rows.map((r) => correctOf(r, m))
  const answered = vals.filter((v) => v !== null).length
  const acc = vals.filter((v) => v === true).length / n
  accs.set(m, acc)
  console.log(`${m.padEnd(34)} ${pct(acc).padStart(6)}  ${String(answered).padStart(8)}  ${String(n - answered).padStart(8)}`)
}

console.log(`\nvoters: ${voters.length} (${voters.join(", ")})`)
const needed = Math.ceil((voters.length + 1) / 2)
let voteCorrect = 0, voteResolved = 0, tieCount = 0
let strictCorrect = 0, strictResolved = 0
for (const r of rows) {
  const mj = majority(r, voters)
  if (mj.tied) tieCount++
  if (mj.letter != null) {
    voteResolved++
    if (mj.letter === r.gold) voteCorrect++
    if (mj.agreement * mj.considered >= needed) {
      strictResolved++
      if (mj.letter === r.gold) strictCorrect++
    }
  }
}
console.log(`plurality vote     acc ${pct(voteCorrect / n)}   resolved ${voteResolved}/${n}   ties ${tieCount}`)
console.log(`majority (>=${needed})      acc ${pct(strictCorrect / n)}   resolved ${strictResolved}/${n}`)
if (BRAIN) console.log(`brain alone        acc ${pct(accs.get(BRAIN) ?? 0)}   (${BRAIN})`)

const bestVoter = voters.slice().sort((a, b) => (accs.get(b) ?? 0) - (accs.get(a) ?? 0))[0]
console.log(`best single voter  acc ${pct(accs.get(bestVoter) ?? 0)}   (${bestVoter})`)

console.log("\npairwise error correlation (phi) — the bench assumes 0")
let sum = 0, pairs = 0
for (let i = 0; i < voters.length; i++) {
  for (let j = i + 1; j < voters.length; j++) {
    let a = 0, b = 0, c = 0, d = 0
    for (const r of rows) {
      const x = correctOf(r, voters[i]), y = correctOf(r, voters[j])
      if (x === null || y === null) continue
      if (x && y) a++; else if (x && !y) b++; else if (!x && y) c++; else d++
    }
    const den = Math.sqrt((a + b) * (c + d) * (a + c) * (b + d))
    const phi = den === 0 ? 0 : (a * d - b * c) / den
    sum += phi; pairs++
    console.log(`  ${voters[i].split("/")[1]} x ${voters[j].split("/")[1]}`.padEnd(46) + phi.toFixed(3))
  }
}
console.log(`  mean phi`.padEnd(46) + (pairs ? sum / pairs : 0).toFixed(3))

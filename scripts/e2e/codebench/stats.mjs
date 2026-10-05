function exerciseMean(runs) { return runs.reduce((s, x) => s + x, 0) / runs.length }

function round(x) { return Math.round(x * 1e6) / 1e6 }

function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function passRate(arm) {
  const keys = Object.keys(arm)
  return keys.length ? round(keys.reduce((s, k) => s + exerciseMean(arm[k]), 0) / keys.length) : 0
}

export function pairedBootstrap(a, b, { iterations = 10000, seed = 1 } = {}) {
  const keys = Object.keys(a).filter((k) => k in b).sort()
  const deltas = keys.map((k) => exerciseMean(a[k]) - exerciseMean(b[k]))
  const n = deltas.length
  if (!n) return { n: 0, diff: 0, lo: 0, hi: 0 }
  const diff = deltas.reduce((s, d) => s + d, 0) / n
  const next = rng(seed)
  const samples = []
  for (let i = 0; i < iterations; i++) {
    let sum = 0
    for (let j = 0; j < n; j++) sum += deltas[Math.floor(next() * n)]
    samples.push(sum / n)
  }
  samples.sort((x, y) => x - y)
  return { n, diff: round(diff), lo: round(samples[Math.floor(0.025 * iterations)]), hi: round(samples[Math.min(iterations - 1, Math.floor(0.975 * iterations))]) }
}

function binom(n, k) {
  let r = 1
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
  return r
}

export function signTest(a, b) {
  const keys = Object.keys(a).filter((k) => k in b)
  let aOnly = 0
  let bOnly = 0
  for (const k of keys) {
    const pa = exerciseMean(a[k]) >= 0.5
    const pb = exerciseMean(b[k]) >= 0.5
    if (pa && !pb) aOnly++
    else if (pb && !pa) bOnly++
  }
  const n = aOnly + bOnly
  if (!n) return { aOnly, bOnly, p: 1 }
  const k = Math.min(aOnly, bOnly)
  let tail = 0
  for (let i = 0; i <= k; i++) tail += binom(n, i)
  return { aOnly, bOnly, p: round(Math.min(1, (2 * tail) / 2 ** n)) }
}

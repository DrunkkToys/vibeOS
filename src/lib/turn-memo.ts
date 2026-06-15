// @ts-nocheck
// Per-turn memoization cache — eliminates redundant computation within a single hook chain.
// Cleared at the start of each turn via nextTurn().

const _memo = new Map<string, { value: any; gen: number }>()
let _turnGen = 0
const MAX_MEMO_SIZE = 200

export function memoCompute<T>(key: string, compute: () => T): T {
  const entry = _memo.get(key)
  if (entry !== undefined && entry.gen === _turnGen) {
    return entry.value as T
  }
  const value = compute()
  _memo.set(key, { value, gen: _turnGen })
  if (_memo.size > MAX_MEMO_SIZE) {
    const iter = _memo.keys()
    for (let i = 0; i < 50; i++) {
      const k = iter.next()
      if (k.done) break
      if (_memo.get(k.value)?.gen !== _turnGen) _memo.delete(k.value)
    }
  }
  return value
}

export function memoizeFn<T extends (...args: any[]) => any>(fn: T, keyPrefix: string): T {
  return ((...args: any[]) => {
    const key = `${keyPrefix}:${JSON.stringify(args)}`
    return memoCompute(key, () => fn(...args))
  }) as T
}

export function nextTurn(): void {
  _turnGen++
  if (_memo.size > MAX_MEMO_SIZE) {
    const iter = _memo.keys()
    for (let i = 0; i < 50; i++) {
      const k = iter.next()
      if (k.done) break
      if (_memo.get(k.value)?.gen !== _turnGen) _memo.delete(k.value)
    }
  }
}

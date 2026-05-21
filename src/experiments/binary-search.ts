/**
 * Generic binary search on a sorted array.
 *
 * @experiment 20260521T115722.774Z-algorithm-binary-search
 *
 * @param arr - A sorted array (ascending) of any comparable type.
 * @param target - The element to search for.
 * @returns The index of the target if found, otherwise -1.
 *
 * @example
 * ```ts
 * binarySearch([1, 3, 5, 7, 9], 5) // => 2
 * binarySearch([1, 3, 5, 7, 9], 4) // => -1
 * binarySearch([], 1)              // => -1
 * binarySearch([42], 42)          // => 0
 * binarySearch([42], 99)          // => -1
 * ```
 */
function binarySearch<T>(arr: T[], target: T): number {
  if (arr.length === 0) return -1

  let lo = 0
  let hi = arr.length - 1

  while (lo <= hi) {
    const mid = lo + Math.floor((hi - lo) / 2)

    if (arr[mid] === target) return mid
    if (arr[mid] < target) {
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  return -1
}

// ----- tests (run: npx ts-node src/experiments/binary-search.ts) -----

function test(name: string, fn: () => boolean) {
  const ok = fn()
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) process.exitCode = 1
}

test('empty array', () => binarySearch([], 1) === -1)

test('single element — found', () => binarySearch([7], 7) === 0)

test('single element — not found', () => binarySearch([7], 3) === -1)

test('target at start', () => binarySearch([1, 3, 5, 7, 9], 1) === 0)

test('target at end', () => binarySearch([1, 3, 5, 7, 9], 9) === 4)

test('target in middle', () => binarySearch([1, 3, 5, 7, 9], 5) === 2)

test('target not found — between elements', () => binarySearch([1, 3, 5, 7, 9], 4) === -1)

test('target not found — beyond array', () => binarySearch([1, 3, 5, 7, 9], 100) === -1)

test('string array', () => binarySearch(['a', 'b', 'c', 'd'], 'c') === 2)

test('string not found', () => binarySearch(['a', 'b', 'c', 'd'], 'z') === -1)

export function getNumericCents(cents: number | string | null | undefined): number {
  if (cents === null || cents === undefined) {
    return 0
  }

  const numeric = typeof cents === 'string' ? parseFloat(cents) : cents
  if (Number.isNaN(numeric)) return 0
  return numeric
}

export function formatCentsAsDollars(cents: number | string | null | undefined): string {
  const numeric = getNumericCents(cents)
  const dollars = Math.floor(Math.abs(numeric) / 100)
  const remainder = Math.abs(numeric) % 100
  const sign = numeric < 0 ? '-' : ''
  return `${sign}$${dollars}.${String(remainder).padStart(2, '0')}`
}

export function formatCost(cents: number | string | null | undefined): string {
  const numeric = getNumericCents(cents)
  if (numeric === 0 && (cents === null || cents === undefined)) {
    return '$0.00'
  }

  const rounded = Math.round(numeric)
  const absolute = Math.abs(rounded)
  const dollars = Math.floor(absolute / 100)
  const remainder = absolute % 100
  const sign = rounded < 0 ? '-' : ''

  return `${sign}$${dollars}.${String(remainder).padStart(2, '0')}`
}

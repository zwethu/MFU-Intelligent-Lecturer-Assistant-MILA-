/* Date arithmetic for the activity journal, shared by the meter dialog (which
   shows the newest day) and the journal page (which lays a whole month out as
   a calendar). Both name days the same way, so they have to agree on it. */

/** YYYY-MM for a month `offset` months before now, in the user's clock. */
export function monthKey(offset: number): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() - offset, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthTitle(key: string): string {
  const [year, month] = key.split('-').map(Number)
  if (!year || !month) return key
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

export function dayTitle(date: string, inProgress: boolean): string {
  if (inProgress) return 'Today, so far'
  const [year, month, day] = date.split('-').map(Number)
  if (!year) return date
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  })
}

/** Today as YYYY-MM-DD in the browser's clock — for marking the current cell. */
export function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

/**
 * A month as 7-column calendar cells, `null` for the blanks before the 1st.
 *
 * Weeks start on Sunday because `Date.getDay()` does, and a calendar that
 * disagrees with its own arithmetic is one off-by-one away from painting every
 * day on the wrong square.
 */
export function monthCells(key: string): Array<string | null> {
  const [year, month] = key.split('-').map(Number)
  if (!year || !month) return []
  const lead = new Date(year, month - 1, 1).getDay()
  // Day 0 of the next month is the last day of this one.
  const days = new Date(year, month, 0).getDate()

  const cells: Array<string | null> = Array(lead).fill(null)
  for (let day = 1; day <= days; day += 1) {
    cells.push(`${key}-${String(day).padStart(2, '0')}`)
  }
  return cells
}

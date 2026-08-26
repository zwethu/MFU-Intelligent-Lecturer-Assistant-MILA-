import { useEffect, useState } from 'react'

/**
 * Whether the viewport is wide enough for a side-by-side layout.
 *
 * For panels that must be a COLUMN on a wide screen and an OVERLAY on a narrow
 * one. Doing that switch in CSS alone would leave both copies mounted, which
 * duplicates every control in the DOM and breaks any query expecting one.
 *
 * The default query is deliberately Tailwind's `lg` breakpoint, to the pixel.
 * Callers pair this with `lg:` classes: JS picks which panel renders, CSS picks
 * the columns. If the two ever disagree you get a band of widths where the rail
 * is styled as a column but rendered as an overlay, so **the query and the
 * Tailwind prefix have to be changed together or not at all.**
 *
 * Defaults to `true` where `matchMedia` is missing — jsdom does not implement it
 * (verified), so tests exercise the inline column, which is the primary layout.
 * A test that wants the overlay has to stub `window.matchMedia` itself.
 */
export function useIsWideViewport(query = '(min-width: 1024px)'): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

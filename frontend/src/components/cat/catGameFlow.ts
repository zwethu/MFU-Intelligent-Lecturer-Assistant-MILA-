/**
 * What happens when a round finishes: end the session, or turn the page.
 *
 * Pulled out of CatGame as a pure function because it is the one genuinely fiddly
 * branch in the game engine — four independent reasons a round can end, only one of
 * which continues — and CatGame itself cannot be rendered in a test without mocking
 * audio, lottie and all three mode components.
 */
export type PageOutcome = 'finalize' | 'advance';

export function nextAfterPage({
  timedOut,
  skipAll,
  skipRound,
  isLastPage,
}: {
  /** The clock ran out. Ends the whole session wherever it happens. */
  timedOut: boolean;
  /** "Skip to results" was pressed. Ends the whole session. */
  skipAll: boolean;
  /** "Skip round" was pressed. Ends this round ONLY — unless it is the last one. */
  skipRound: boolean;
  isLastPage: boolean;
}): PageOutcome {
  if (timedOut) return 'finalize';
  if (skipAll) return 'finalize';
  if (isLastPage) return 'finalize';
  // skipRound deliberately does NOT finalize here: it has already been handled by
  // the two terminal cases above when it lands on the last page, and everywhere
  // else it means "advance", which is what the fall-through gives.
  if (skipRound) return 'advance';
  return 'advance';
}

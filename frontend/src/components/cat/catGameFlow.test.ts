import { describe, expect, it } from 'vitest';

import { nextAfterPage } from './catGameFlow';

/**
 * Four independent reasons a round can end, only one of which continues the
 * session. Table-tested here because CatGame cannot be rendered without mocking
 * audio, lottie and all three mode components.
 */
describe('nextAfterPage', () => {
  const base = { timedOut: false, skipAll: false, skipRound: false, isLastPage: false };

  it('advances after an ordinary cleared round', () => {
    expect(nextAfterPage(base)).toBe('advance');
  });

  it('finalizes on the last round', () => {
    expect(nextAfterPage({ ...base, isLastPage: true })).toBe('finalize');
  });

  it('finalizes when the clock ran out', () => {
    expect(nextAfterPage({ ...base, timedOut: true })).toBe('finalize');
  });

  it('finalizes when the clock ran out even mid-session', () => {
    expect(nextAfterPage({ ...base, timedOut: true, isLastPage: false })).toBe('finalize');
  });

  it('finalizes on skip-to-results', () => {
    expect(nextAfterPage({ ...base, skipAll: true })).toBe('finalize');
  });

  // The whole point of the per-round control: it must NOT end the session.
  it('advances on a skipped round when more rounds remain', () => {
    expect(nextAfterPage({ ...base, skipRound: true })).toBe('advance');
  });

  it('finalizes on a skipped round when it was the last one', () => {
    expect(nextAfterPage({ ...base, skipRound: true, isLastPage: true })).toBe('finalize');
  });

  // Skip-to-results wins: whoever pressed it wants out, not one round on.
  it('finalizes when both skips are somehow set', () => {
    expect(nextAfterPage({ ...base, skipRound: true, skipAll: true })).toBe('finalize');
  });

  it('finalizes when a round is skipped as the clock runs out', () => {
    expect(nextAfterPage({ ...base, skipRound: true, timedOut: true })).toBe('finalize');
  });
});

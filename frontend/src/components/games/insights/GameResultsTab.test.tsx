// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const getGameInsights = vi.fn()

// Mocking the service keeps lib/api -> lib/firebase out of jsdom entirely, which
// is what stops this file joining the ones that cannot even load.
vi.mock('../../../services/gameService', () => ({
  getGameInsights: (...a: unknown[]) => getGameInsights(...a),
  downloadGameResults: vi.fn(),
  updateGame: vi.fn(),
  gamePlayUrl: (gameId: string) => `http://localhost/play/${gameId}`,
}))

import { GameResultsTab } from './GameResultsTab'
import type { GameInsights, GameSession, StudentInsight } from '../../../services/gameService'

const game = { gameId: 'g1', batchId: 'b1', title: 'Project Management', itemCount: 30 } as GameSession

const measures = (over = {}) => ({
  firstTryAccuracyPercent: 71, trialAccuracyPercent: 80, medal: 'gold', gameMode: 'matching',
  correctCount: 30, submitCount: 5, wrongSubmitCount: 0, wrongPairs: 0,
  realWorkSeconds: 292, playSeconds: 473, awaySeconds: 181, awayCount: 2,
  wallClockSeconds: 486, timeLimitSeconds: 900, planningSeconds: 8.4,
  medianSubmitGapSeconds: 34.2, medianReviewSeconds: 5.4, reviewCount: 8, timedOut: false,
  roundsCompleted: 5, totalRounds: 5, completedAt: null, ...over,
})

const student = (over: Partial<StudentInsight> = {}): StudentInsight =>
  ({
    rowId: 'uid-1', playerUid: 'uid-1', email: 'somchai@x.ac.th', rosterName: 'Somchai', nickname: 'Speedy',
    onRoster: true, played: true, band: 'typical', signals: [], flags: [],
    approach: 'planner', measures: measures(), rounds: [],
    ...over,
  }) as StudentInsight

const insights = (over: Partial<GameInsights> = {}): GameInsights =>
  ({
    gameId: 'g1', title: 'Project Management', totalQuestions: 30,
    class: {
      rosterCount: 3, playedCount: 2, neverPlayedCount: 1, timedOutCount: 0,
      medianFirstTryAccuracy: 71, medianRealWorkSeconds: 480, medianWrongSubmits: 4,
      medianSubmitGapSeconds: 11.2, highReworkSubmits: 16, heavyReworkSubmits: 10,
      neverAwayCount: 1, awayMedianSecondsAmongAway: 118,
      bands: { typical: 1, one: 0, two: 1 },
      approaches: { planner: 2, trial_and_error: 0, steady: 0 },
      flags: { ran_out_of_time: 0, high_rework: 0, struggling: 1, never_played: 1 },
      thresholds: { longAbsenceSeconds: 90, roundAbsenceSeconds: 20, highReworkSubmits: 16, strugglingFirstTryPercent: 50 },
    },
    students: [
      student({
        rowId: 'uid-2', playerUid: 'uid-2', rosterName: 'Pim', email: 'pim@x.ac.th', band: 'two',
        signals: [
          { id: 'long_absences', awaySeconds: 181, roundsAway: 2, realWorkSeconds: 292, classMedianRealWorkSeconds: 480 },
          { id: 'flawless_run', firstTryAccuracy: 100, submits: 5, rounds: 5, classMedianFirstTryAccuracy: 71 },
        ],
      }),
      student({ rowId: 'uid-1', playerUid: 'uid-1', rosterName: 'Somchai', flags: ['struggling'] }),
      student({
        rowId: 'arun@x.ac.th', playerUid: '', rosterName: 'Arun', email: 'arun@x.ac.th', played: false,
        band: null, measures: null, approach: null, flags: ['never_played'],
      }),
    ],
    ...over,
  }) as GameInsights

function renderTab() {
  return render(
    <MemoryRouter>
      <GameResultsTab batchId="b1" game={game} onError={vi.fn()} />
    </MemoryRouter>,
  )
}

afterEach(cleanup)
beforeEach(() => {
  getGameInsights.mockReset()
  getGameInsights.mockResolvedValue(insights())
})

describe('GameResultsTab', () => {
  /**
   * The disclaimer is the difference between a panel that starts a conversation
   * and one that ends a student's term. It is not behind a tooltip, and it is not
   * below the fold of student rows.
   */
  it('states what the panel cannot see, before any student', async () => {
    renderTab()
    await screen.findByText(/What these numbers can and cannot tell you/)

    expect(screen.getByText(/cannot see a phone on the desk/)).toBeTruthy()
    expect(screen.getByText(/no percentages and no verdicts/)).toBeTruthy()
  })

  it('loads the insights for this game', async () => {
    renderTab()
    await screen.findByText(/What these numbers can and cannot tell you/)
    expect(getGameInsights).toHaveBeenCalledWith('b1', 'g1')
  })

  it('lands on a student so the detail panel is never empty on arrival', async () => {
    const { container } = renderTab()
    await screen.findByText(/What these numbers can and cannot tell you/)

    // The drilldown is the one <aside> on the page.
    await waitFor(() => expect(container.querySelectorAll('aside')).toHaveLength(1))
    expect(screen.queryByText('Pick a student to read their run.')).toBeNull()

    // Scoped to the detail card: "Right first time" is also a class-median tile
    // above, which is correct — the same measurement at two scopes.
    const detail = container.querySelector('aside') as HTMLElement
    expect(within(detail).getByText('Right first time')).toBeTruthy()
    expect(within(detail).getByText('Where the time went')).toBeTruthy()
  })

  it('shows the evidence behind a signal, with the class comparison', async () => {
    renderTab()
    await screen.findByText(/The tab was hidden for a while/)

    // One paragraph carries the measurement, the class comparison and the caveat.
    const body = screen.getByText(/does not say what was on the other side of it/)
    expect(body.textContent).toContain('3m 1s')
    expect(body.textContent).toContain('class median')
  })

  it('counts a flawless run once, and says so', async () => {
    renderTab()
    await screen.findByText(/Every round was right first time/)
    expect(screen.getByText(/It counts once\./)).toBeTruthy()
  })

  it('separates the students who never opened it', async () => {
    const user = userEvent.setup()
    renderTab()
    await screen.findByText(/What these numbers can and cannot tell you/)

    await user.click(screen.getByRole('button', { name: /Never played/ }))
    expect(await screen.findByText(/never opened it/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Copy 1 email address/ })).toBeTruthy()
  })

  it('filters to the students who struggled', async () => {
    const user = userEvent.setup()
    renderTab()
    await screen.findByText(/What these numbers can and cannot tell you/)

    await user.click(screen.getByRole('button', { name: /Found it hard/ }))
    // Pim is gone from the list; Somchai survives in both the row and the drilldown.
    expect(screen.queryByText('Pim')).toBeNull()
    expect(screen.getAllByText('Somchai').length).toBeGreaterThan(0)
  })

  it('keeps the CSV, but not as the way in', async () => {
    renderTab()
    await screen.findByRole('button', { name: /Download raw data/ })
    expect(screen.getByText(/one row per student/)).toBeTruthy()
  })

  it('says so when nobody has played yet', async () => {
    getGameInsights.mockResolvedValue(
      insights({
        students: [],
        class: { ...insights().class, playedCount: 0, neverPlayedCount: 0, rosterCount: 0 },
      }),
    )
    renderTab()
    expect(await screen.findByText('No results yet.')).toBeTruthy()
  })

  it('offers a retry when the results cannot be read', async () => {
    getGameInsights.mockRejectedValue(new Error('Firestore is unreachable'))
    renderTab()

    expect(await screen.findByText('Firestore is unreachable')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Try again/ })).toBeTruthy()
  })

  it('shows a loading state distinct from empty and from failed', async () => {
    getGameInsights.mockReturnValue(new Promise(() => {}))
    renderTab()

    expect(await screen.findByText(/Reading the results/)).toBeTruthy()
    expect(screen.queryByText('No results yet.')).toBeNull()
  })

  /** The panel must never print the number that is 100 for everyone who finished. */
  it('never shows final accuracy', async () => {
    renderTab()
    await screen.findByText(/What these numbers can and cannot tell you/)
    await waitFor(() => expect(screen.queryByText(/^Accuracy$/)).toBeNull())
  })

  // ─── Pace ─────────────────────────────────────────────────────────────────

  it('shows both pace numbers with the caveats that make them safe to read', async () => {
    renderTab()
    await screen.findByText(/Typical time between answers/)

    expect(screen.getByText(/not an average/)).toBeTruthy()
    expect(screen.getByText(/do not add the two together/)).toBeTruthy()
    expect(screen.getByText('across 8 pauses')).toBeTruthy()
  })

  it('sets the gap against the class median', async () => {
    renderTab()
    const label = await screen.findByText(/Typical time between answers/)

    // Scoped to the pace row: "class median" also appears in the signal bodies,
    // which is the same rule applied in a different place.
    const row = label.closest('div') as HTMLElement
    expect(row.textContent).toContain('class median')
  })

  /** 0s would read as "answered instantly" — the opposite of what happened. */
  it('shows a dash, not 0s, when there were no pauses to read feedback', async () => {
    getGameInsights.mockResolvedValue(
      insights({
        students: [student({ measures: measures({ reviewCount: 0, medianReviewSeconds: null }) })],
      }),
    )
    renderTab()
    await screen.findByText(/Typical time between answers/)

    expect(screen.getByText('no pauses recorded')).toBeTruthy()
  })
})

/**
 * The narrow layout.
 *
 * jsdom does not implement matchMedia (verified), so useIsWideViewport falls back
 * to `true` and every test above exercises the inline column. Without this stub
 * the drawer would ship with no coverage at all.
 */
describe('GameResultsTab on a narrow screen', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    })
  })

  afterEach(() => {
    // @ts-expect-error putting jsdom back the way it was found
    delete window.matchMedia
  })

  it('opens the detail as a dialog, and not also as a column', async () => {
    const user = userEvent.setup()
    const { container } = renderTab()
    await screen.findByText(/What these numbers can and cannot tell you/)

    // Nothing on arrival — the drawer opens on a click, never by itself.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(container.querySelectorAll('aside')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: /Pim/ }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    // One copy, never two: the inline column must not also be mounted.
    expect(container.querySelectorAll('aside')).toHaveLength(0)
  })

  it('warns a screen reader that the row opens a dialog', async () => {
    renderTab()
    await screen.findByText(/What these numbers can and cannot tell you/)
    expect(
      screen.getByRole('button', { name: /Pim/ }).getAttribute('aria-haspopup'),
    ).toBe('dialog')
  })

  it('closes on Escape and puts focus back on the row', async () => {
    const user = userEvent.setup()
    renderTab()
    await screen.findByText(/What these numbers can and cannot tell you/)

    const row = screen.getByRole('button', { name: /Pim/ })
    await user.click(row)
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(row))
  })

  it('keeps the row selected after the drawer is dismissed', async () => {
    const user = userEvent.setup()
    renderTab()
    await screen.findByText(/What these numbers can and cannot tell you/)

    const row = screen.getByRole('button', { name: /Pim/ })
    await user.click(row)
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(row.getAttribute('aria-pressed')).toBe('true')
  })
})

/**
 * The bug this file did not catch.
 *
 * Roster students carry no playerUid, so every never-played row used to fall
 * through to `""`. Selecting one then matched the FIRST empty-id row rather than
 * the clicked one, and every never-played row reported aria-pressed="true" at
 * once. Identity now rides on `rowId`, which is never empty.
 */
describe('rows that share no player id are still distinct', () => {
  const arun = student({
    rowId: 'arun@x.ac.th', playerUid: '', rosterName: 'Arun', email: 'arun@x.ac.th',
    played: false, band: null, measures: null, approach: null, flags: ['never_played'],
  })
  const nok = student({
    rowId: 'nok@x.ac.th', playerUid: '', rosterName: 'Nok', email: 'nok@x.ac.th',
    played: false, band: null, measures: null, approach: null, flags: ['never_played'],
  })

  beforeEach(() => {
    getGameInsights.mockResolvedValue(
      insights({
        students: [arun, nok],
        class: { ...insights().class, playedCount: 0, neverPlayedCount: 2, rosterCount: 2 },
      }),
    )
  })

  it('gives two never-played students different row ids', () => {
    expect(arun.rowId).not.toBe(nok.rowId)
    expect(arun.rowId).toBeTruthy()
    expect(nok.rowId).toBeTruthy()
  })

  it('selects only the student that was clicked', async () => {
    const user = userEvent.setup()
    renderTab()
    await screen.findByText(/What these numbers can and cannot tell you/)

    const arunRow = screen.getByRole('button', { name: /Arun/ })
    const nokRow = screen.getByRole('button', { name: /Nok/ })

    await user.click(nokRow)

    expect(nokRow.getAttribute('aria-pressed')).toBe('true')
    expect(arunRow.getAttribute('aria-pressed')).toBe('false')
  })
})

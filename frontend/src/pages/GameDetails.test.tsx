// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const getGame = vi.fn()
const updateGame = vi.fn()

// Mocking the service module keeps lib/api -> lib/firebase out of jsdom entirely,
// which is how the rest of this suite avoids running initializeAuth at import time.
vi.mock('../services/gameService', () => ({
  getGame: (...args: unknown[]) => getGame(...args),
  updateGame: (...args: unknown[]) => updateGame(...args),
  downloadGameResults: vi.fn(),
  gamePlayUrl: (gameId: string) => `${window.location.origin}/play/${gameId}`,
}))

import GameDetails from './GameDetails'
import { ConfirmHost } from '../components/ui/ConfirmDialog'
import { resetConfirmStore } from '../components/ui/confirmStore'
import type { GameSession } from '../services/gameService'

const pair = (n: number) => ({ id: `item_${n}`, term: `Term ${n}`, definition: `Definition ${n}` })

const game = (over: Partial<GameSession> = {}): GameSession =>
  ({
    gameId: 'g1',
    batchId: 'b1',
    lecturerId: 'lect-1',
    chatId: 'c1',
    runId: 'r1',
    title: 'Software Project Management Fundamentals',
    items: [pair(1), pair(2), pair(3), pair(4)],
    itemCount: 4,
    modes: ['matching'],
    gameModeStats: {},
    status: 'open',
    contentHash: 'hash',
    createdAt: '2026-08-10T00:00:00Z',
    attemptCount: 0,
    ...over,
  }) as GameSession

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/batches/b1/games/g1']}>
      <Routes>
        <Route path="/batches/:batchId/games/:gameId" element={<GameDetails />} />
      </Routes>
      <ConfirmHost />
    </MemoryRouter>,
  )
}

/** Wait for the page to finish its initial load. */
const loaded = () => screen.findByRole('heading', { level: 1 })

afterEach(() => {
  cleanup()
  resetConfirmStore()
})

beforeEach(() => {
  getGame.mockReset()
  updateGame.mockReset()
  getGame.mockResolvedValue(game())
  updateGame.mockImplementation(async () => game())
})

describe('GameDetails', () => {
  it('loads the game named in the URL and lists its pairs', async () => {
    renderPage()
    await loaded()

    expect(getGame).toHaveBeenCalledWith('b1', 'g1')
    expect(screen.getByText('Software Project Management Fundamentals')).toBeTruthy()
    expect(screen.getByText('Term 1')).toBeTruthy()
    expect(screen.getByText('Definition 4')).toBeTruthy()
  })

  /**
   * The point of the page: the student link is reachable from it, so a lecturer
   * testing their own game starts here rather than at the roster gate.
   */
  it('offers the plain student play link, in a new tab', async () => {
    renderPage()
    await loaded()

    const play = screen.getByRole('link', { name: /Play \/ test game/ })
    expect(play.getAttribute('href')).toContain('/play/g1')
    expect(play.getAttribute('target')).toBe('_blank')
    // No preview flag on the URL — preview is granted by being the creator.
    expect(play.getAttribute('href')).not.toContain('preview')
  })

  it('saves an edited term as the whole board', async () => {
    const user = userEvent.setup()
    renderPage()
    await loaded()

    await user.click(screen.getByRole('button', { name: /Edit pairs/ }))
    const term = screen.getByLabelText('Term for pair 1')
    await user.clear(term)
    await user.type(term, 'Scope creep')
    await user.click(screen.getByRole('button', { name: /Save changes/ }))

    await waitFor(() => expect(updateGame).toHaveBeenCalled())
    expect(updateGame).toHaveBeenCalledWith('b1', 'g1', {
      items: [
        { term: 'Scope creep', definition: 'Definition 1' },
        { term: 'Term 2', definition: 'Definition 2' },
        { term: 'Term 3', definition: 'Definition 3' },
        { term: 'Term 4', definition: 'Definition 4' },
      ],
    })
  })

  it('adds a pair to the submitted board', async () => {
    const user = userEvent.setup()
    renderPage()
    await loaded()

    await user.click(screen.getByRole('button', { name: /Edit pairs/ }))
    await user.click(screen.getByRole('button', { name: /Add pair/ }))
    await user.type(screen.getByLabelText('Term for pair 5'), 'Milestone')
    await user.type(screen.getByLabelText('Definition for pair 5'), 'A checkpoint')
    await user.click(screen.getByRole('button', { name: /Save changes/ }))

    await waitFor(() => expect(updateGame).toHaveBeenCalled())
    const items = updateGame.mock.calls[0][2].items
    expect(items).toHaveLength(5)
    expect(items[4]).toEqual({ term: 'Milestone', definition: 'A checkpoint' })
  })

  it('reorders the board with Move up', async () => {
    const user = userEvent.setup()
    renderPage()
    await loaded()

    await user.click(screen.getByRole('button', { name: /Edit pairs/ }))
    await user.click(screen.getByRole('button', { name: 'Move pair 2 up' }))
    await user.click(screen.getByRole('button', { name: /Save changes/ }))

    await waitFor(() => expect(updateGame).toHaveBeenCalled())
    const items = updateGame.mock.calls[0][2].items
    expect(items[0].term).toBe('Term 2')
    expect(items[1].term).toBe('Term 1')
  })

  // ─── Validation stops a save the backend would refuse ─────────────────────

  it('refuses to save below the minimum, and says why', async () => {
    const user = userEvent.setup()
    renderPage()
    await loaded()

    await user.click(screen.getByRole('button', { name: /Edit pairs/ }))
    await user.click(screen.getByRole('button', { name: 'Remove pair 4' }))

    expect(screen.getByText(/needs at least 4 pairs/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Save changes/ }).hasAttribute('disabled')).toBe(true)
  })

  it('refuses to save two terms that differ only by case', async () => {
    const user = userEvent.setup()
    renderPage()
    await loaded()

    await user.click(screen.getByRole('button', { name: /Edit pairs/ }))
    const second = screen.getByLabelText('Term for pair 2')
    await user.clear(second)
    await user.type(second, 'term 1')

    expect(screen.getByText(/share the same term/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Save changes/ }).hasAttribute('disabled')).toBe(true)
  })

  it('refuses to save a pair with an empty definition', async () => {
    const user = userEvent.setup()
    renderPage()
    await loaded()

    await user.click(screen.getByRole('button', { name: /Edit pairs/ }))
    await user.clear(screen.getByLabelText('Definition for pair 3'))

    expect(screen.getByText(/needs both a term and a definition/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Save changes/ }).hasAttribute('disabled')).toBe(true)
  })

  // ─── Warning before overwriting a board students were scored against ──────

  it('saves without a warning when nobody has played', async () => {
    const user = userEvent.setup()
    renderPage()
    await loaded()

    await user.click(screen.getByRole('button', { name: /Edit pairs/ }))
    await user.click(screen.getByRole('button', { name: /Save changes/ }))

    await waitFor(() => expect(updateGame).toHaveBeenCalled())
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('warns, naming the count, once students have played', async () => {
    getGame.mockResolvedValue(game({ attemptCount: 3 }))
    const user = userEvent.setup()
    renderPage()
    await loaded()

    await user.click(screen.getByRole('button', { name: /Edit pairs/ }))
    await user.click(screen.getByRole('button', { name: /Save changes/ }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('3 students')
    expect(updateGame).not.toHaveBeenCalled()
  })

  it('does not save when the warning is dismissed', async () => {
    getGame.mockResolvedValue(game({ attemptCount: 3 }))
    const user = userEvent.setup()
    renderPage()
    await loaded()

    await user.click(screen.getByRole('button', { name: /Edit pairs/ }))
    await user.click(screen.getByRole('button', { name: /Save changes/ }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /Cancel/ }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(updateGame).not.toHaveBeenCalled()
  })

  it('saves once the warning is accepted', async () => {
    getGame.mockResolvedValue(game({ attemptCount: 3 }))
    const user = userEvent.setup()
    renderPage()
    await loaded()

    await user.click(screen.getByRole('button', { name: /Edit pairs/ }))
    await user.click(screen.getByRole('button', { name: /Save changes/ }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /Change pairs/ }))

    await waitFor(() => expect(updateGame).toHaveBeenCalled())
  })

  /**
   * The failure that matters most: a count we could not take must not read as zero,
   * or the warning silently disappears at exactly the moment it is load-bearing.
   */
  it('warns when the play count is unknown', async () => {
    getGame.mockResolvedValue(game({ attemptCount: null }))
    const user = userEvent.setup()
    renderPage()
    await loaded()

    await user.click(screen.getByRole('button', { name: /Edit pairs/ }))
    await user.click(screen.getByRole('button', { name: /Save changes/ }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('could not check')
    expect(updateGame).not.toHaveBeenCalled()
  })

  it('surfaces the server’s reason when the game cannot be loaded', async () => {
    getGame.mockRejectedValue(new Error('Game not found or access denied'))
    renderPage()

    expect(await screen.findByText('Game not found or access denied')).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
  })

  it('falls back to its own wording when the failure carries no message', async () => {
    // getErrorMessage prefers err.message and only then the fallback, so a
    // non-Error rejection is what actually exercises the page's own sentence.
    getGame.mockRejectedValue({})
    renderPage()

    expect(await screen.findByText(/That game could not be loaded/)).toBeTruthy()
  })
})

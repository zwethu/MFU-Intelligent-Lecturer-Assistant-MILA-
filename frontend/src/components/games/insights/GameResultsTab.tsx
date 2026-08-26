import { useCallback, useEffect, useMemo, useState } from 'react'
import { BarChart3, Eye, Search, X } from 'lucide-react'

import {
  getGameInsights,
  type GameInsights,
  type GameSession,
  type StudentInsight,
} from '../../../services/gameService'
import { getErrorMessage } from '../../../utils/errors'
import { useIsWideViewport } from '../../../hooks/useIsWideViewport'
import { PageSpinner } from '../../../design-system'
import { GameResultsButton } from '../GameRow'
import { ClassOverview } from './ClassOverview'
import { StudentSignalRow } from './StudentSignalRow'
import { StudentDrilldown, StudentDrilldownHeader } from './StudentDrilldown'
import { StudentDrilldownDrawer } from './StudentDrilldownDrawer'
import { NeverPlayedList } from './NeverPlayedList'

/**
 * Interpreted results for one game — what a lecturer sees instead of opening the
 * CSV and reading 43 columns by eye.
 */

type Filter = 'all' | 'signals' | 'struggling' | 'never_played'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Everyone' },
  { id: 'signals', label: 'Signals' },
  { id: 'struggling', label: 'Found it hard' },
  { id: 'never_played', label: 'Never played' },
]

/**
 * Stated in full, permanently, above everything — not behind a tooltip.
 * A disclaimer you have to hover for is one nobody read, and this one is the
 * difference between a panel that starts a conversation and one that ends a
 * student's term.
 *
 * On white, not slate-50: a grey surface is this app's code for "inert/disabled",
 * and this was the first thing on the tab.
 */
function Disclaimer() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <Eye className="h-4 w-4 text-violet-600" aria-hidden="true" />
        What these numbers can and cannot tell you
      </h2>
      <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-slate-600">
        <li>
          The game can measure how long the tab was hidden, how long each round took, and
          how many answers came back wrong.
        </li>
        <li>
          It cannot see a phone on the desk, a second window beside this one, or the
          reason someone stepped away — a text message and a search look the same from here.
        </li>
        <li className="font-medium text-slate-700">
          So there are no percentages and no verdicts. Use these to decide who is worth a
          quick conversation.
        </li>
      </ul>
    </section>
  )
}

export function GameResultsTab({
  batchId,
  game,
  onError,
}: {
  batchId: string
  game: GameSession
  onError: (message: string) => void
}) {
  const [insights, setInsights] = useState<GameInsights | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Narrow screens only. NOT derived from `selected` — the panel opens on click,
  // never on arrival, and closing it must leave the row selected.
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Pairs with the `lg:` prefixes below; the query is Tailwind's lg to the pixel.
  const isWide = useIsWideViewport()

  const gameId = game.gameId
  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setInsights(await getGameInsights(batchId, gameId))
    } catch (err) {
      setError(getErrorMessage(err, 'Those results could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [batchId, gameId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const students = useMemo(() => insights?.students ?? [], [insights])

  const matchesSearch = useCallback(
    (s: StudentInsight) => {
      const needle = query.trim().toLowerCase()
      if (!needle) return true
      return `${s.rosterName} ${s.nickname} ${s.email}`.toLowerCase().includes(needle)
    },
    [query],
  )

  const searched = useMemo(() => students.filter(matchesSearch), [students, matchesSearch])

  const visible = useMemo(
    () =>
      searched.filter((s) => {
        if (filter === 'signals') return s.played && s.band !== 'typical'
        if (filter === 'struggling') return s.flags.includes('struggling')
        if (filter === 'never_played') return !s.played
        return true
      }),
    [searched, filter],
  )

  // Land on the first row rather than an empty panel: an empty detail pane on
  // arrival reads as a page that failed to load (the lesson from Journal.tsx).
  const selected: StudentInsight | null =
    visible.find((s) => s.rowId === selectedId) ?? visible.find((s) => s.played) ?? null

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <PageSpinner label="Reading the results…" />
      </div>
    )
  }

  if (error || !insights) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        <p>{error || 'Those results could not be loaded.'}</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="mt-3 rounded-md border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
        >
          Try again
        </button>
      </div>
    )
  }

  if (insights.class.playedCount === 0 && insights.class.neverPlayedCount === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <BarChart3 className="mx-auto h-8 w-8 text-slate-300" />
        <p className="mt-3 text-sm font-medium text-slate-700">No results yet.</p>
        <p className="mt-1 text-sm text-slate-500">
          Share the game link with your class — results appear here as students finish.
        </p>
      </div>
    )
  }

  // Counted from what the search left, so a filter chip can never claim 101 while
  // one row is on screen.
  const counts: Record<Filter, number> = {
    all: searched.length,
    signals: searched.filter((s) => s.played && s.band !== 'typical').length,
    struggling: searched.filter((s) => s.flags.includes('struggling')).length,
    never_played: searched.filter((s) => !s.played).length,
  }
  const searching = query.trim().length > 0

  return (
    <div className="space-y-4">
      <Disclaimer />
      <ClassOverview insights={insights} />

      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <div role="group" aria-label="Filter students" className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                aria-pressed={filter === f.id}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 ${
                  filter === f.id
                    ? 'border-violet-300 bg-violet-50 font-semibold text-violet-800'
                    : 'border-slate-200 bg-white font-medium text-slate-700 hover:border-violet-200 hover:bg-violet-50/50'
                }`}
              >
                {f.label}
                <span className="ml-1.5 tabular-nums text-slate-500">{counts[f.id]}</span>
              </button>
            ))}
          </div>

          <label className="ml-auto flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 focus-within:border-violet-500 focus-within:ring-1 focus-within:ring-violet-500">
            <Search className="h-4 w-4 flex-shrink-0 text-slate-500" aria-hidden="true" />
            <span className="sr-only">Search students by name or email</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or email"
              className="w-44 border-0 p-0 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-0"
            />
            {searching && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="flex-shrink-0 rounded text-slate-500 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </label>
        </div>

        <div className="p-4">
          {/* Says what is on screen against what exists, so a short list never looks
              like a broken one. */}
          <p className="mb-3 text-xs text-slate-500" aria-live="polite">
            Showing <span className="font-semibold tabular-nums text-slate-700">{visible.length}</span>{' '}
            of {students.length}
            {searching && <> matching “{query.trim()}”</>}
          </p>

          {filter === 'never_played' ? (
            <NeverPlayedList students={visible} />
          ) : (
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
              <ul className="space-y-2">
                {visible.length === 0 && (
                  <li className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                    Nobody matches that.
                    {searching && (
                      <button
                        type="button"
                        onClick={() => setQuery('')}
                        className="ml-1.5 font-medium text-violet-700 underline underline-offset-2 hover:text-violet-800"
                      >
                        Clear the search
                      </button>
                    )}
                  </li>
                )}
                {visible.map((student) => (
                  <li key={student.rowId}>
                    <StudentSignalRow
                      student={student}
                      selected={selected?.rowId === student.rowId}
                      totalSignals={2}
                      opensDialog={!isWide}
                      onSelect={() => {
                        setSelectedId(student.rowId)
                        if (!isWide) setDrawerOpen(true)
                      }}
                    />
                  </li>
                ))}
              </ul>

              {/* A column OR an overlay, never both: rendering both and hiding one
                  with CSS leaves two copies of every control in the DOM.

                  The CARD is the scroll container, with its header outside the
                  scroller. Wrapping a card in a scroller instead — which is what
                  this did before — makes the border, radius and padding part of the
                  scrolled content, so they travel up and get clipped at a square
                  transparent edge. Every scrollable panel in this app does it this
                  way round. */}
              {isWide ? (
                <aside className="sticky top-6 flex max-h-[calc(100vh-6rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  {selected && (
                    <header className="flex-shrink-0 border-b border-slate-100 px-4 py-3">
                      <StudentDrilldownHeader student={selected} />
                    </header>
                  )}
                  <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
                    <StudentDrilldown student={selected} insights={insights} />
                  </div>
                </aside>
              ) : (
                <StudentDrilldownDrawer
                  student={selected}
                  insights={insights}
                  open={drawerOpen}
                  onClose={() => setDrawerOpen(false)}
                />
              )}
            </div>
          )}
        </div>
      </section>

      {/* Kept, demoted. The client said the DATA was good — it was the reading of
          it that hurt — so the escape hatch stays for anyone who wants the numbers. */}
      <footer className="px-1">
        <GameResultsButton batchId={batchId} game={game} onError={onError} quiet />
        <p className="mt-1.5 text-xs text-slate-500">
          Every measurement behind this panel, one row per student — including the ones
          who never played.
        </p>
      </footer>
    </div>
  )
}

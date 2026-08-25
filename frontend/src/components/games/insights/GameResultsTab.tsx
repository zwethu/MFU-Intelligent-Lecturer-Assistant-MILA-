import { useCallback, useEffect, useMemo, useState } from 'react'
import { BarChart3, Eye, Search } from 'lucide-react'

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
import { StudentDrilldown } from './StudentDrilldown'
import { StudentDrilldownDrawer } from './StudentDrilldownDrawer'
import { NeverPlayedList } from './NeverPlayedList'

/**
 * Interpreted results for one game — what a lecturer sees instead of opening the
 * CSV and reading 43 columns by eye.
 */

type Filter = 'all' | 'signals' | 'struggling' | 'never_played'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'signals', label: 'Signals' },
  { id: 'struggling', label: 'Struggling' },
  { id: 'never_played', label: 'Never played' },
]

/**
 * Stated in full, permanently, above everything — not behind a tooltip.
 * A disclaimer you have to hover for is one nobody read, and this one is the
 * difference between a panel that starts a conversation and one that ends a
 * student's term. The wording is deliberately close to docs/game-results-csv.md,
 * so the documentation and the product say the same thing.
 */
function Disclaimer() {
  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <Eye className="h-4 w-4 text-slate-500" />
        What this panel can and cannot see
      </h3>
      {/* Three lines, not three paragraphs. The substance is unchanged — what we
          measure, what we cannot, and that none of it proves anything — but a
          lecturer between classes will actually read this version. */}
      <ul className="mt-2 space-y-1 text-sm leading-relaxed text-slate-600">
        <li>We can see hidden-tab time and wrong answers.</li>
        <li>We cannot see a phone, a second window, or why someone left.</li>
        <li className="font-medium text-slate-700">
          No percentages: these start a conversation, they do not prove anything.
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
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
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

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return students.filter((s) => {
      if (filter === 'signals' && (s.band === 'typical' || !s.played)) return false
      if (filter === 'struggling' && !s.flags.includes('struggling')) return false
      if (filter === 'never_played' && s.played) return false
      if (!needle) return true
      return `${s.rosterName} ${s.nickname} ${s.email}`.toLowerCase().includes(needle)
    })
  }, [students, filter, query])

  // Land on the first row rather than an empty panel: an empty detail pane on
  // arrival reads as a page that failed to load (the lesson from Journal.tsx).
  const selected: StudentInsight | null =
    visible.find((s) => s.playerUid === selectedUid) ?? visible.find((s) => s.played) ?? null

  if (loading) {
    return (
      // The branded mark on the panel's own surface, so the tab does not collapse
      // to a thin bar while it loads.
      <div className="rounded-xl border border-slate-200 bg-white">
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
          className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
        >
          Try again
        </button>
      </div>
    )
  }

  if (insights.class.playedCount === 0 && insights.class.neverPlayedCount === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
        <BarChart3 className="mx-auto h-8 w-8 text-slate-300" />
        <p className="mt-3 text-sm font-medium text-slate-700">No results yet.</p>
        <p className="mt-1 text-sm text-slate-500">
          Share the game link with your class — results appear here as students finish.
        </p>
      </div>
    )
  }

  const counts: Record<Filter, number> = {
    all: students.length,
    signals: students.filter((s) => s.played && s.band !== 'typical').length,
    struggling: insights.class.flags.struggling,
    never_played: insights.class.neverPlayedCount,
  }

  return (
    <div className="space-y-4">
      <Disclaimer />
      <ClassOverview insights={insights} />

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
              filter === f.id
                ? 'border-violet-300 bg-violet-100 text-violet-900'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {f.label}
            <span className="ml-1.5 text-slate-500">{counts[f.id]}</span>
          </button>
        ))}
        {students.length > 6 && (
          <label className="ml-auto flex items-center gap-1.5">
            <Search className="h-4 w-4 text-slate-500" aria-hidden="true" />
            <span className="sr-only">Search students</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or email"
              className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
            />
          </label>
        )}
      </div>

      {filter === 'never_played' ? (
        <NeverPlayedList students={students.filter((s) => !s.played)} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <ul className="space-y-2">
            {visible.length === 0 && (
              <li className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                Nothing matches that.
              </li>
            )}
            {visible.map((student) => (
              <li key={student.playerUid || student.email}>
                <StudentSignalRow
                  student={student}
                  selected={selected?.playerUid === student.playerUid}
                  totalSignals={2}
                  opensDialog={!isWide}
                  onSelect={() => {
                    setSelectedUid(student.playerUid)
                    if (!isWide) setDrawerOpen(true)
                  }}
                />
              </li>
            ))}
          </ul>
          {/* A column OR an overlay, never both: rendering both and hiding one
              with CSS leaves two copies of every control in the DOM.

              The sticky wrapper is what fixes the original complaint — with the
              card pinned, clicking a row at the bottom of 98 needs no scroll
              back up, so there is nothing for scrollIntoView to do (and
              BatchTabs documents why reaching for it would be wrong).

              lg:self-start is mandatory: a stretched grid item is as tall as its
              row and sticky would have nowhere to travel. The height cap plus the
              inner scroller is a deliberate exception to MaterialsTab's
              no-nested-scroller rule — a pinned card's tail is otherwise
              unreachable, and here the scrollbar sits still beside a moving list
              rather than hiding inside another scroller. */}
          {isWide ? (
            <div className="lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-4.5rem)] lg:overflow-y-auto lg:[scrollbar-gutter:stable]">
              <StudentDrilldown student={selected} insights={insights} />
            </div>
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

      {/* Kept, demoted. The client said the DATA was good — it was the reading of
          it that hurt — so the escape hatch stays for anyone who wants the numbers. */}
      <footer className="border-t border-slate-100 pt-4">
        <GameResultsButton batchId={batchId} game={game} onError={onError} quiet />
        <p className="mt-1.5 text-xs text-slate-500">
          Every measurement behind this panel, one row per student — including the ones
          who never played.
        </p>
      </footer>
    </div>
  )
}

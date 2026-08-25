import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, BarChart3, Gamepad2, ListChecks, Play } from 'lucide-react'

import { GameCopyLinkButton, GameSchedule } from '../components/games/GameRow'
import { GamePairsEditor } from '../components/games/GamePairsEditor'
import { GameResultsTab } from '../components/games/insights/GameResultsTab'
import { BatchTabs, type TabSpec } from './batches/components/BatchTabs'
import { gamePlayUrl, getGame, type GameSession } from '../services/gameService'
import { getErrorMessage } from '../utils/errors'
import { PageSpinner } from '../design-system'

/**
 * One game, in full — the page "Open game" now lands on.
 *
 * That button used to jump straight to the student link, which put a lecturer at the
 * roster gate of their own game with no way back into it. The two things they actually
 * want are here instead: change what the game asks, and try it as a student would.
 */

function formatCreated(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

type GameTab = 'pairs' | 'results'

function tabsFor(attemptCount?: number | null): TabSpec<GameTab>[] {
  return [
    { id: 'pairs', label: 'Pairs', icon: ListChecks },
    {
      id: 'results',
      label: 'Results',
      icon: BarChart3,
      // Omitted at 0 and at null — a badge reading "0" and a badge reading
      // "we could not count" are both worse than no badge.
      badge: attemptCount || undefined,
      badgeLabel: attemptCount ? `${attemptCount} students played` : undefined,
    },
  ]
}

export default function GameDetails() {
  // batchId rides in the URL rather than coming from useBatchSelection, which
  // auto-selects the FIRST batch — on a deep link that would be the wrong one.
  const { batchId = '', gameId = '' } = useParams<{ batchId: string; gameId: string }>()

  const [game, setGame] = useState<GameSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // The tab lives in the query string so a results view can be linked and
  // reloaded. `replace: true` because switching tabs is not a navigation — a
  // lecturer pressing Back wants the games list, not the tab they just left.
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const [tab, setTabState] = useState<GameTab>(requestedTab === 'results' ? 'results' : 'pairs')
  const [tabPinned, setTabPinned] = useState(requestedTab !== null)

  const setTab = useCallback(
    (next: GameTab) => {
      setTabState(next)
      setTabPinned(true)
      const params = new URLSearchParams(searchParams)
      params.set('tab', next)
      setSearchParams(params, { replace: true })
    },
    [searchParams, setSearchParams],
  )

  // Once the game loads, open on Results if anyone has played — that is what the
  // lecturer came for. `attemptCount` is null when the count FAILED, which must
  // fall back to Pairs rather than showing an empty panel.
  useEffect(() => {
    if (tabPinned || !game) return
    if ((game.attemptCount ?? 0) > 0) setTabState('results')
  }, [game, tabPinned])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setGame(await getGame(batchId, gameId))
    } catch (err) {
      setError(getErrorMessage(err, 'That game could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [batchId, gameId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (loading) return <PageSpinner />

  if (error || !game) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Link
          to="/games"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-violet-700"
        >
          <ArrowLeft className="h-4 w-4" /> Games
        </Link>
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm text-slate-700">
            {/* The backend answers 404 for both "gone" and "not yours", so this
                cannot promise which — and should not guess. */}
            {error || "That game could not be found, or it isn't yours."}
          </p>
        </div>
      </div>
    )
  }

  const created = formatCreated(game.createdAt)

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <Link
        to="/games"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-violet-700"
      >
        <ArrowLeft className="h-4 w-4" /> Games
      </Link>

      <header className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-4">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
            <Gamepad2 className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold text-slate-900">{game.title}</h1>
              {game.status === 'closed' && (
                <span className="flex-shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                  Closed
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {game.itemCount} pair{game.itemCount === 1 ? '' : 's'}
              {created ? ` · created ${created}` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3">
          {/* The plain student URL, deliberately — preview is granted by being the
              game's creator, not by anything carried in the link. */}
          <a
            href={gamePlayUrl(game.gameId)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
          >
            <Play className="h-4 w-4" /> Play / test game
          </a>
          <GameCopyLinkButton gameId={game.gameId} />
        </div>
        <GameSchedule batchId={batchId} game={game} onUpdated={setGame} onError={setError} />
      </header>

      <BatchTabs<GameTab>
        tabs={tabsFor(game.attemptCount)}
        active={tab}
        onChange={setTab}
        label="Game sections"
      />

      {tab === 'results' ? (
        <GameResultsTab batchId={batchId} game={game} onError={setError} />
      ) : (
        <GamePairsEditor batchId={batchId} game={game} onSaved={setGame} onError={setError} />
      )}
    </div>
  )
}

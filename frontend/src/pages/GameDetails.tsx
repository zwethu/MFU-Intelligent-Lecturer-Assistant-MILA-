import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Gamepad2, Play } from 'lucide-react'

import {
  GameCopyLinkButton,
  GameResultsButton,
  GameSchedule,
} from '../components/games/GameRow'
import { GamePairsEditor } from '../components/games/GamePairsEditor'
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

export default function GameDetails() {
  // batchId rides in the URL rather than coming from useBatchSelection, which
  // auto-selects the FIRST batch — on a deep link that would be the wrong one.
  const { batchId = '', gameId = '' } = useParams<{ batchId: string; gameId: string }>()

  const [game, setGame] = useState<GameSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
          <GameResultsButton batchId={batchId} game={game} onError={setError} />
        </div>
        <GameSchedule batchId={batchId} game={game} onUpdated={setGame} onError={setError} />
      </header>

      <GamePairsEditor batchId={batchId} game={game} onSaved={setGame} onError={setError} />
    </div>
  )
}

import api from '../lib/api'

export type GameItem = {
  /** Backend-assigned, stable per game — the player app keys per-item progress on it. */
  id: string
  term: string
  definition: string
}

/** Play counter per mode, keyed by the stored spellings: bucket, matching, ropelink. */
export type GameModeStats = Record<string, number>

/**
 * A created, playable game. Field names are camelCase because the backend writes the
 * gameSessions document in the shape the player client consumes.
 */
export type GameSession = {
  gameId: string
  batchId: string
  lecturerId: string
  chatId: string
  runId: string
  title: string
  items: GameItem[]
  itemCount: number
  modes: string[]
  gameModeStats: GameModeStats
  status: string
  contentHash: string
  createdAt?: string | null
  updatedAt?: string | null
  expiresAt?: string | null
  /** When students stop being allowed to play. Null means the game has no deadline. */
  deadlineAt?: string | null
  idempotent?: boolean
  /**
   * Students who have finished this game. Present only on the single-game read
   * (`getGame`) and on an `updateGame` response — the list endpoint would need one
   * aggregation query per row to answer a question only the details page asks.
   *
   * `null` means the count could not be taken, which is NOT the same as zero: the
   * pairs editor warns before overwriting a played board, and must also warn when it
   * cannot tell whether the board has been played.
   */
  attemptCount?: number | null
}

/** A pair as the editor holds it. No `id` — the backend assigns those on save. */
export type GameItemDraft = { term: string; definition: string }

// ─── Interpreted results ────────────────────────────────────────────────────
// The panel that replaced reading the CSV by eye. Every number here is computed
// by the backend — including the class medians a student is compared against —
// so the band a row shows can never disagree with the evidence beside it.

/**
 * How many independent signals fired. Not a score and not a probability: nothing
 * in this app has ever been labelled "used AI" or "didn't", so there is nothing
 * for a probability to be a probability of.
 */
export type InsightBand = 'typical' | 'one' | 'two'

/** Needing help, which is a different question from the band. */
export type FlagId = 'ran_out_of_time' | 'high_rework' | 'struggling' | 'never_played'

/** How they went about it. Descriptive — none of these is better than another. */
export type ApproachId = 'planner' | 'trial_and_error' | 'steady'

/**
 * One signal, carrying its own measurements AND the class comparator — the row
 * writes a sentence from these rather than looking up canned copy by id.
 */
export type InsightSignal =
  | {
      id: 'long_absences'
      awaySeconds: number | null
      roundsAway: number
      realWorkSeconds: number | null
      classMedianRealWorkSeconds: number | null
    }
  | {
      id: 'flawless_run'
      firstTryAccuracy: number | null
      submits: number
      rounds: number
      classMedianFirstTryAccuracy: number | null
    }

export type InsightMeasures = {
  firstTryAccuracyPercent: number | null
  trialAccuracyPercent: number | null
  medal: string
  gameMode: string
  correctCount: number | null
  submitCount: number | null
  wrongSubmitCount: number | null
  wrongPairs: number | null
  realWorkSeconds: number | null
  playSeconds: number | null
  awaySeconds: number | null
  awayCount: number | null
  wallClockSeconds: number | null
  timeLimitSeconds: number | null
  planningSeconds: number | null
  medianSubmitGapSeconds: number | null
  medianReviewSeconds: number | null
  timedOut: boolean
  roundsCompleted: number | null
  totalRounds: number | null
  completedAt: string | null
  // No `accuracy`: it is 100 by construction for anyone who finished, so the
  // backend omits it entirely rather than trusting every caller not to show it.
}

export type InsightRound = {
  index: number
  seconds: number | null
  awaySeconds: number | null
  realWorkSeconds: number | null
  submits: number | null
  wrongSubmits: number | null
  itemCount: number | null
  completed: boolean
}

export type StudentInsight = {
  /** The React key. `email` can be empty on an attempt made off-roster. */
  playerUid: string
  email: string
  rosterName: string
  nickname: string
  onRoster: boolean
  played: boolean
  band: InsightBand | null
  signals: InsightSignal[]
  flags: FlagId[]
  approach: ApproachId | null
  measures: InsightMeasures | null
  rounds: InsightRound[]
}

export type ClassInsights = {
  rosterCount: number
  playedCount: number
  neverPlayedCount: number
  timedOutCount: number
  medianFirstTryAccuracy: number | null
  medianRealWorkSeconds: number | null
  medianWrongSubmits: number | null
  medianSubmitGapSeconds: number | null
  highReworkSubmits: number
  heavyReworkSubmits: number
  /** Away-time is bimodal, so these two describe it and a plain median does not. */
  neverAwayCount: number
  awayMedianSecondsAmongAway: number | null
  bands: Record<InsightBand, number>
  approaches: Record<ApproachId, number>
  flags: Record<FlagId, number>
  thresholds: {
    longAbsenceSeconds: number
    roundAbsenceSeconds: number
    highReworkSubmits: number
    strugglingFirstTryPercent: number
  }
}

export type GameInsights = {
  gameId: string
  title: string
  totalQuestions: number
  class: ClassInsights
  students: StudentInsight[]
}

/**
 * Interpreted results for one game. Goes through the backend rather than reading
 * Firestore: the rules deny a lecturer any read of the attempts collection,
 * because a lecturer does not own any attempt document.
 */
export async function getGameInsights(
  batchId: string,
  gameId: string,
): Promise<GameInsights> {
  const res = await api.get<GameInsights>(`/batches/${batchId}/games/${gameId}/insights`)
  return res.data
}

/**
 * Terminal action for the game.generate workflow. The content is not sent — the backend
 * reads it from the run's pending artifact, so this can only create the game the agent
 * actually staged. `contentHash` guards against a stale preview card.
 */
export async function createGameFromRun(
  batchId: string,
  chatId: string,
  runId: string,
  contentHash?: string,
  deadlineAt?: string | null,
): Promise<GameSession> {
  const res = await api.post<GameSession>(`/batches/${batchId}/games/from-run`, {
    chat_id: chatId,
    run_id: runId,
    content_hash: contentHash || '',
    deadline_at: deadlineAt || null,
  })
  return res.data
}

/**
 * Edit a live game: its pairs, its deadline, or whether it is open. Omitted fields are
 * left alone, so dropping a deadline takes the explicit flag rather than a null.
 *
 * `items` is the WHOLE board in play order, not a patch of changed rows — the backend
 * replaces the array wholesale and reassigns every item id, so send what the game
 * should now contain.
 */
export async function updateGame(
  batchId: string,
  gameId: string,
  changes: {
    deadlineAt?: string
    clearDeadline?: boolean
    status?: 'open' | 'closed'
    items?: GameItemDraft[]
  },
): Promise<GameSession> {
  const res = await api.patch<GameSession>(`/batches/${batchId}/games/${gameId}`, {
    ...(changes.deadlineAt ? { deadline_at: changes.deadlineAt } : {}),
    ...(changes.clearDeadline ? { clear_deadline: true } : {}),
    ...(changes.status ? { status: changes.status } : {}),
    // Presence, not truthiness: an empty array is invalid input the backend should
    // reject with a message, not a key that silently vanishes on the way out.
    ...(changes.items !== undefined ? { items: changes.items } : {}),
  })
  return res.data
}

/**
 * The link a lecturer hands to students. `/play/:id` is a public route — students
 * sign in there with Google and are checked against the batch roster — so this is
 * an absolute URL, meant to be pasted into an email or an LMS.
 */
export function gamePlayUrl(gameId: string): string {
  return `${window.location.origin}/play/${gameId}`
}

export async function listGames(batchId: string): Promise<GameSession[]> {
  const res = await api.get<GameSession[]>(`/batches/${batchId}/games`)
  return res.data
}

export async function getGame(batchId: string, gameId: string): Promise<GameSession> {
  const res = await api.get<GameSession>(`/batches/${batchId}/games/${gameId}`)
  return res.data
}

export async function deleteGame(batchId: string, gameId: string): Promise<void> {
  await api.delete(`/batches/${batchId}/games/${gameId}`)
}

/**
 * Downloads one game's results as a CSV, one row per enrolled student — including
 * the ones who never played, so the lecturer can see who to chase.
 *
 * The blob is built here rather than pointing an <a href> at the endpoint because
 * the request needs the auth header; a bare link would arrive unauthenticated.
 */
export async function downloadGameResults(batchId: string, gameId: string): Promise<void> {
  const res = await api.get(`/batches/${batchId}/games/${gameId}/results.csv`, {
    responseType: 'blob',
  })

  // Prefer the filename the server chose — it carries the game title and date.
  const disposition = String(res.headers['content-disposition'] ?? '')
  const match = disposition.match(/filename="?([^"]+)"?/)
  const filename = match?.[1] ?? `game-results-${gameId}.csv`

  const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

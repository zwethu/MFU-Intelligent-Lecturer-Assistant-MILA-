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

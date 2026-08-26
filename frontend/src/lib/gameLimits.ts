/**
 * How many pairs a game may hold.
 *
 * Mirrors MIN_GAME_ITEMS / MAX_GAME_ITEMS in backend/entity/GameSession.py, which is
 * the authority — the backend re-validates every write and will return a 422 if these
 * drift. They live here so the generator form and the pairs editor cannot disagree
 * with each other about the bounds while both quietly disagreeing with the server.
 */
export const MIN_GAME_PAIRS = 4
export const MAX_GAME_PAIRS = 40

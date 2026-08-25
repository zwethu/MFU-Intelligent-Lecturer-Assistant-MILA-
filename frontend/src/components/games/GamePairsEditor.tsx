import { useState } from 'react'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'

import { confirm } from '../ui/confirmStore'
import { FIELD_CLASS, FIELD_INVALID_CLASS, TEXTAREA_CLASS } from '../ui/fieldStyles'
import { MAX_GAME_PAIRS, MIN_GAME_PAIRS } from '../../lib/gameLimits'
import { updateGame, type GameSession } from '../../services/gameService'
import { getErrorMessage } from '../../utils/errors'
import { Spinner } from '../../design-system'

/**
 * The pairs of a live game, editable in place.
 *
 * Until this existed a typo in a question was permanent: the agent authored the board
 * once at creation and no endpoint could touch `items` afterwards. A lecturer reviewing
 * their own game before sending it out could see the mistake and not fix it.
 */

/**
 * One row while it is being edited.
 *
 * `key` is a client-side identity for React only — deliberately NOT the server's
 * `item.id`. The backend renumbers ids positionally on every save, so keying rows on
 * the server id would remount every row below an insertion and throw away its focus
 * and cursor position mid-edit.
 */
type DraftRow = { key: string; term: string; definition: string }

let rowSeq = 0
function newKey(): string {
  rowSeq += 1
  return `row-${rowSeq}`
}

function toDraft(game: GameSession): DraftRow[] {
  return game.items.map((item) => ({
    key: newKey(),
    term: item.term,
    definition: item.definition,
  }))
}

/**
 * Everything wrong with the board right now, in the order a lecturer would fix it.
 *
 * Mirrors the backend's validation (entity/GameSession.py) so a save that would come
 * back 422 is stopped here with a sentence instead — the server stays the authority,
 * this is only about not making someone press a button to be told no.
 */
export function pairIssues(rows: DraftRow[]): string[] {
  const issues: string[] = []
  const trimmed = rows.map((r) => ({ term: r.term.trim(), definition: r.definition.trim() }))

  if (trimmed.length < MIN_GAME_PAIRS) {
    issues.push(`A game needs at least ${MIN_GAME_PAIRS} pairs — this one has ${trimmed.length}.`)
  }
  if (trimmed.length > MAX_GAME_PAIRS) {
    issues.push(`A game can hold at most ${MAX_GAME_PAIRS} pairs — this one has ${trimmed.length}.`)
  }
  if (trimmed.some((r) => !r.term || !r.definition)) {
    issues.push('Every pair needs both a term and a definition.')
  }

  // Case-insensitive, because the matching modes key on the term: "Scope creep" and
  // "scope creep" are one question with two right answers, which is unplayable.
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const row of trimmed) {
    if (!row.term) continue
    const key = row.term.toLowerCase()
    if (seen.has(key)) duplicates.add(row.term)
    seen.add(key)
  }
  if (duplicates.size > 0) {
    issues.push(`Two pairs share the same term: ${[...duplicates].join(', ')}.`)
  }

  return issues
}

/** Which rows collide on term, so the offending inputs can be marked individually. */
function duplicateKeys(rows: DraftRow[]): Set<string> {
  const byTerm = new Map<string, string[]>()
  for (const row of rows) {
    const key = row.term.trim().toLowerCase()
    if (!key) continue
    byTerm.set(key, [...(byTerm.get(key) ?? []), row.key])
  }
  const flagged = new Set<string>()
  for (const keys of byTerm.values()) {
    if (keys.length > 1) keys.forEach((k) => flagged.add(k))
  }
  return flagged
}

export function GamePairsEditor({
  batchId,
  game,
  onSaved,
  onError,
}: {
  batchId: string
  game: GameSession
  onSaved: (game: GameSession) => void
  onError: (message: string) => void
}) {
  // A draft exists only while editing — its presence IS the dirty flag, which is the
  // convention the blueprint editor established rather than a separate isDirty bool.
  const [draft, setDraft] = useState<DraftRow[] | null>(null)
  const [saving, setSaving] = useState(false)

  const issues = draft ? pairIssues(draft) : []
  const dupes = draft ? duplicateKeys(draft) : new Set<string>()

  function update(index: number, field: 'term' | 'definition', value: string) {
    setDraft((rows) =>
      rows ? rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)) : rows,
    )
  }

  function move(index: number, delta: -1 | 1) {
    setDraft((rows) => {
      if (!rows) return rows
      const target = index + delta
      if (target < 0 || target >= rows.length) return rows
      const next = [...rows]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  async function handleSave() {
    if (!draft || issues.length > 0) return
    const items = draft.map((row) => ({
      term: row.term.trim(),
      definition: row.definition.trim(),
    }))

    // `attemptCount` is null when the count could not be taken, and undefined on a game
    // object that never came from the detail endpoint. Both mean "we cannot tell", and
    // both must warn — only a confirmed zero is safe to save silently.
    const played = game.attemptCount
    const unknown = played === null || played === undefined
    if (unknown || played > 0) {
      const ok = await confirm({
        title: unknown
          ? 'Change the pairs?'
          : `Change the pairs after ${played} student${played === 1 ? '' : 's'} played?`,
        body: unknown
          ? 'We could not check whether anyone has played this game yet. If they have, ' +
            'their saved results were scored against the current pairs and will not change.'
          : 'Their saved results were scored against the old pairs and will not change. ' +
            'Future results — and the totals in the CSV export — will use the new ones.',
        confirmLabel: 'Change pairs',
        tone: 'danger',
      })
      if (!ok) return
    }

    setSaving(true)
    try {
      onSaved(await updateGame(batchId, game.gameId, { items }))
      setDraft(null)
    } catch (err) {
      onError(getErrorMessage(err, 'Those pairs could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  if (!draft) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white">
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Pairs
            <span className="ml-2 font-normal text-slate-500">
              {game.itemCount} pair{game.itemCount === 1 ? '' : 's'}
            </span>
          </h2>
          <button
            type="button"
            onClick={() => setDraft(toDraft(game))}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Pencil className="h-4 w-4" /> Edit pairs
          </button>
        </header>
        <ol className="divide-y divide-slate-100">
          {game.items.map((item, index) => (
            <li key={item.id || `${game.gameId}-${index}`} className="flex gap-3 px-4 py-2.5 text-sm">
              <span className="w-6 flex-shrink-0 text-right text-xs text-slate-400">
                {index + 1}
              </span>
              <span className="font-medium text-slate-800">{item.term}</span>
              <span className="text-slate-400">—</span>
              <span className="text-slate-600">{item.definition}</span>
            </li>
          ))}
        </ol>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-violet-200 bg-white">
      <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">
          Editing pairs
          <span className="ml-2 font-normal text-slate-500">
            {draft.length} pair{draft.length === 1 ? '' : 's'}
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDraft(null)}
            disabled={saving}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || issues.length > 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {saving && <Spinner size={16} />}
            Save changes
          </button>
        </div>
      </header>

      <ol className="divide-y divide-slate-100">
        {draft.map((row, index) => {
          // Swapped, not appended — FIELD_INVALID_CLASS redefines the same border
          // utilities, and both sets present would leave the winner to source order.
          const termBad = dupes.has(row.key) || !row.term.trim()
          const defBad = !row.definition.trim()
          return (
          <li key={row.key} className="flex gap-2 px-4 py-3">
            <span className="w-6 flex-shrink-0 pt-2 text-right text-xs text-slate-400">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <input
                value={row.term}
                onChange={(e) => update(index, 'term', e.target.value)}
                aria-label={`Term for pair ${index + 1}`}
                aria-invalid={termBad ? true : undefined}
                placeholder="Term"
                className={termBad ? FIELD_INVALID_CLASS : FIELD_CLASS}
              />
              <textarea
                value={row.definition}
                onChange={(e) => update(index, 'definition', e.target.value)}
                aria-label={`Definition for pair ${index + 1}`}
                aria-invalid={defBad ? true : undefined}
                rows={2}
                placeholder="Definition"
                className={defBad ? `${FIELD_INVALID_CLASS} resize-y` : TEXTAREA_CLASS}
              />
            </div>
            <div className="flex flex-shrink-0 flex-col gap-1">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label={`Move pair ${index + 1} up`}
                className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === draft.length - 1}
                aria-label={`Move pair ${index + 1} down`}
                className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30"
              >
                <ArrowDown className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setDraft((rows) => rows?.filter((_, i) => i !== index) ?? rows)}
                aria-label={`Remove pair ${index + 1}`}
                className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
          )
        })}
      </ol>

      <footer className="space-y-2 border-t border-slate-100 px-4 py-3">
        <button
          type="button"
          onClick={() =>
            setDraft((rows) => [...(rows ?? []), { key: newKey(), term: '', definition: '' }])
          }
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <Plus className="h-4 w-4" /> Add pair
        </button>
        {/* Spelled out, not signalled by colour: the Save button being dim does not
            tell anyone WHY, and a red border alone fails for anyone who cannot see it. */}
        {issues.length > 0 && (
          <ul className="space-y-1 text-sm text-red-700">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
      </footer>
    </section>
  )
}

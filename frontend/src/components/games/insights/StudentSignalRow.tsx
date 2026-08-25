import type { StudentInsight } from '../../../services/gameService'
import { APPROACH_WORD, BAND_SURFACE, BAND_WORD, FLAG_STYLE, bandAriaLabel } from './signalBand'
import { rowSummary } from './signalCopy'

/**
 * One student in the list.
 *
 * A button, not a table row: the row is selectable and a `<tr>` cannot hold focus.
 * The band pill always carries its word — never colour alone, which is invisible
 * to roughly one reader in eight.
 */
export function StudentSignalRow({
  student,
  selected,
  totalSignals,
  onSelect,
}: {
  student: StudentInsight
  selected: boolean
  totalSignals: number
  onSelect: () => void
}) {
  const name = student.rosterName || student.nickname || student.email || 'Unknown student'

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-xl border p-3 text-left transition-colors ${
        selected
          ? 'border-violet-300 bg-violet-50/60'
          : 'border-slate-200 bg-white hover:bg-slate-50'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {student.email}
            {!student.onRoster && ' · not on the roster'}
          </p>
        </div>
        {student.band && (
          <span
            aria-label={bandAriaLabel(name, student.band, totalSignals)}
            className={`flex-shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${BAND_SURFACE[student.band]}`}
          >
            {BAND_WORD[student.band]}
          </span>
        )}
      </div>

      <p className="mt-1.5 text-xs text-slate-600">
        {rowSummary(student)}
        {student.approach && student.played && ` · ${APPROACH_WORD[student.approach]}`}
      </p>

      {student.flags.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {student.flags.map((flag) => (
            <li
              key={flag}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${FLAG_STYLE[flag].cls}`}
            >
              {FLAG_STYLE[flag].label}
            </li>
          ))}
        </ul>
      )}
    </button>
  )
}

import { ChevronRight, User } from 'lucide-react'

import type { StudentInsight } from '../../../services/gameService'
import { APPROACH_WORD, BAND_PILL, BAND_WORD, FLAG_STYLE, bandAriaLabel } from './signalBand'
import { rowSummary } from './signalCopy'

/**
 * One student in the list.
 *
 * A button, not a table row: the row is selectable and a `<tr>` cannot hold focus.
 *
 * It has to LOOK pressable, which the first version did not — it was a plain card
 * with a hover tint, and the tint it used was the app's hover fraction, so the
 * selected row read as merely hovered. Now it carries the app's interactive-card
 * treatment: a leading icon tile like every other entity row, a lift on hover, a
 * violet ring when selected, and a chevron saying there is more to see.
 */
export function StudentSignalRow({
  student,
  selected,
  totalSignals,
  onSelect,
  opensDialog = false,
}: {
  student: StudentInsight
  selected: boolean
  totalSignals: number
  onSelect: () => void
  /**
   * Narrow screens, where the detail arrives as a slide-over rather than beside
   * the list. Without the announcement a screen-reader user gets no warning that
   * a dialog is about to take over the page.
   */
  opensDialog?: boolean
}) {
  const name = student.rosterName || student.nickname || student.email || 'Unknown student'

  return (
    <button
      type="button"
      onClick={onSelect}
      // aria-pressed stays in both layouts: it reports selection, which outlives
      // the drawer being dismissed.
      aria-pressed={selected}
      aria-haspopup={opensDialog ? 'dialog' : undefined}
      className={`group w-full rounded-xl border bg-white p-3 text-left shadow-sm transition-all duration-150
        hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2
        ${selected ? 'border-violet-300 ring-2 ring-violet-500 ring-offset-1' : 'border-slate-200'}`}
    >
      <div className="flex items-start gap-3">
        {/* The same 40px violet tile every other entity row in the app leads with,
            so these read as siblings of the game rows rather than loose panels. */}
        <span
          aria-hidden="true"
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg transition-colors ${
            student.played ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-400'
          }`}
        >
          <User className="h-5 w-5" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {student.email}
            {!student.onRoster && ' · not on the roster'}
          </p>
          <p className="mt-1 truncate text-xs text-slate-600">
            {rowSummary(student)}
            {student.approach && student.played && ` · ${APPROACH_WORD[student.approach]}`}
          </p>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          {student.band && (
            <span
              aria-label={bandAriaLabel(name, student.band, totalSignals)}
              className={`rounded-full border px-2 py-0.5 text-xs font-medium ${BAND_PILL[student.band]}`}
            >
              {BAND_WORD[student.band]}
            </span>
          )}
          <ChevronRight
            aria-hidden="true"
            className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5"
          />
        </div>
      </div>

      {student.flags.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5 pl-[3.25rem]">
          {student.flags.map((flag) => (
            <li
              key={flag}
              className={`rounded-full border px-2 py-0.5 text-xs font-medium ${FLAG_STYLE[flag].cls}`}
            >
              {FLAG_STYLE[flag].label}
            </li>
          ))}
        </ul>
      )}
    </button>
  )
}

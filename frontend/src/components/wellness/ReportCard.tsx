import { Moon } from 'lucide-react'

import { ACTION_LABELS, type DailyReport } from '../../services/wellnessService'
import { LEVEL_TEXT, levelOf, levelWord } from './stressLevel'
import { dayTitle } from './journalDates'

/**
 * One day, as a sentence a person would actually write about their own work.
 *
 * The counts are the day's shape; the grinding line is the part that matters,
 * and it is deliberately written without a verdict. "You kept working for two
 * hours after the meter maxed out" is a fact the lecturer can do something
 * with. "You should have stopped" is a thing they would close the dialog to
 * avoid reading twice.
 */
export function ReportCard({ report }: { report: DailyReport }) {
  const counts = Object.entries(report.actions).filter(([, n]) => n > 0)

  return (
    <div
      className={`rounded-xl border p-3.5 ${
        report.in_progress
          ? 'border-violet-200 bg-violet-50/50'
          : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-slate-800">
          {dayTitle(report.date, report.in_progress)}
        </p>
        <p className="shrink-0 text-xs text-slate-500">
          peak {Math.round(report.peak_score)}
          <span className="text-slate-300"> · </span>
          <span className={LEVEL_TEXT[levelOf(report.peak_score)]}>
            {levelWord(levelOf(report.peak_score))}
          </span>
        </p>
      </div>

      {counts.length === 0 ? (
        <p className="mt-1.5 text-xs text-slate-500">A quiet day — nothing generated.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {counts.map(([action, count]) => (
            <li key={action} className="flex items-baseline gap-2 text-xs text-slate-600">
              <span className="font-semibold tabular-nums text-slate-800">{count}</span>
              <span>{ACTION_LABELS[action] ?? action}</span>
            </li>
          ))}
        </ul>
      )}

      {report.grind_actions > 0 && (
        /* The one line this whole feature exists to be able to write. */
        <p className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
          <Moon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
          <span>
            {report.grind_actions} {report.grind_actions === 1 ? 'thing' : 'things'} done
            with the meter already maxed
            {report.grind_from ? `, from ${report.grind_from}` : ''}.
          </span>
        </p>
      )}

      {report.breathing_done && (
        <p className="mt-2 text-xs text-violet-700">Breathing exercise done.</p>
      )}
    </div>
  )
}

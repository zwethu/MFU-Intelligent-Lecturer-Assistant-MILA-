import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Wind } from 'lucide-react'

import { useStress } from '../context/StressContext'
import {
  getJournal,
  type DailyReport,
  type StressLevel,
} from '../services/wellnessService'
import { Button, Spinner } from '../design-system'
import { levelOf, levelWord } from '../components/wellness/stressLevel'
import {
  monthCells,
  monthKey,
  monthTitle,
  todayKey,
} from '../components/wellness/journalDates'
import { ReportCard } from '../components/wellness/ReportCard'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * One hue, four depths — the same rule the meter's own bar follows.
 *
 * A calendar is read as a shape before it is read as numbers: what a lecturer
 * should see at a glance is where the dark squares cluster, not what any
 * single day scored. Four steps of the brand violet do that; four unrelated
 * hues would make a chart of the days rather than a picture of the month.
 */
const BAND_CELL: Record<StressLevel, string> = {
  low: 'border-violet-100 bg-violet-50 text-violet-900',
  medium: 'border-violet-200 bg-violet-100 text-violet-900',
  high: 'border-violet-300 bg-violet-200 text-violet-900',
  max: 'border-violet-400 bg-violet-300 text-violet-950',
}

const BANDS: StressLevel[] = ['low', 'medium', 'high', 'max']

/**
 * The activity journal, a month at a time.
 *
 * This used to be a scrolling list inside the meter dialog, which meant thirty
 * days arrived as thirty cards you had to wheel through to find the one bad
 * week. A month grid shows all of them at once and answers the question people
 * actually bring here — "how often does this happen?" — from the shape alone,
 * before anything is clicked.
 */
export default function Journal() {
  const { openBreathing } = useStress()
  // Months back from now, so "this month" is always where a visit starts.
  const [offset, setOffset] = useState(0)
  const [entries, setEntries] = useState<DailyReport[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  const month = monthKey(offset)
  const today = todayKey()

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const data = await getJournal(month)
      setEntries(data.entries)
      /* Land on the newest day the month has rather than on nothing: the
         detail panel is half the page, and an empty one on arrival reads as a
         page that failed to load. */
      setSelected(data.entries[0]?.date ?? null)
    } catch (err) {
      console.error('Failed to load wellness journal:', err)
      setFailed(true)
      setEntries([])
      setSelected(null)
    } finally {
      setLoading(false)
    }
  }, [month])

  useEffect(() => {
    void load()
  }, [load])

  const byDate = useMemo(
    () => new Map(entries.map((entry) => [entry.date, entry])),
    [entries],
  )
  const cells = useMemo(() => monthCells(month), [month])
  const selectedReport = selected ? byDate.get(selected) ?? null : null

  return (
    <div className="pb-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Activity journal</h1>
        <p className="text-sm text-slate-500 mt-1">
          Every day the meter recorded, written on its own from the work you did.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setOffset((v) => v + 1)}
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <h2 className="text-sm font-semibold text-slate-800">{monthTitle(month)}</h2>
            <button
              type="button"
              onClick={() => setOffset((v) => Math.max(0, v - 1))}
              disabled={offset === 0}
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-20">
              <Spinner size={24} />
            </div>
          ) : failed ? (
            <p className="py-20 text-center text-xs text-slate-500">
              Could not load your journal.{' '}
              <button
                type="button"
                onClick={() => void load()}
                className="font-semibold text-violet-700 hover:underline"
              >
                Try again
              </button>
            </p>
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1.5">
                {WEEKDAYS.map((day) => (
                  <div
                    key={day}
                    className="pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400"
                  >
                    {day}
                  </div>
                ))}

                {cells.map((date, index) => {
                  if (!date) return <div key={`blank-${index}`} />

                  const report = byDate.get(date)
                  const dayNumber = Number(date.slice(8))
                  const tint = report
                    ? BAND_CELL[levelOf(report.peak_score)]
                    : 'border-slate-100 bg-slate-50/60 text-slate-300'

                  return (
                    <button
                      key={date}
                      type="button"
                      onClick={() => setSelected(date)}
                      disabled={!report}
                      aria-pressed={selected === date}
                      aria-label={
                        report
                          ? `${date}, peak ${Math.round(report.peak_score)}`
                          : `${date}, nothing recorded`
                      }
                      className={`flex h-14 flex-col items-center justify-center gap-0.5 rounded-lg border transition-shadow disabled:cursor-default ${tint} ${
                        selected === date ? 'ring-2 ring-violet-600 ring-offset-1' : ''
                      } ${report ? 'hover:shadow-sm' : ''}`}
                    >
                      <span
                        className={`text-xs tabular-nums ${
                          date === today
                            ? 'font-bold underline decoration-2 underline-offset-2'
                            : 'font-semibold'
                        }`}
                      >
                        {dayNumber}
                      </span>
                      {report && (
                        <span className="text-[10px] tabular-nums opacity-70">
                          {report.total_actions}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
                <span>Peak that day</span>
                {BANDS.map((band) => (
                  <span key={band} className="inline-flex items-center gap-1.5">
                    <span className={`h-3 w-3 rounded border ${BAND_CELL[band]}`} />
                    {levelWord(band)}
                  </span>
                ))}
                <span className="ml-auto">Small number: how much you did.</span>
              </div>
            </>
          )}
        </div>

        <div className="space-y-3">
          {selectedReport ? (
            <ReportCard report={selectedReport} />
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
              {loading
                ? 'Loading…'
                : entries.length === 0
                  ? 'Nothing recorded this month.'
                  : 'Pick a day to read it.'}
            </div>
          )}

          <Button block variant="secondary" onClick={openBreathing}>
            <Wind className="h-4 w-4" aria-hidden="true" />
            Breathing exercise
          </Button>
        </div>
      </div>
    </div>
  )
}

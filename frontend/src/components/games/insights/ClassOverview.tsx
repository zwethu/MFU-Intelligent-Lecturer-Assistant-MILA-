import type { GameInsights, InsightBand } from '../../../services/gameService'
import { BAND_SURFACE, BAND_WORD } from './signalBand'
import { formatSeconds } from './signalCopy'

/**
 * The class before any individual — because a single student's numbers mean
 * nothing without the room they sat in. The away-time line is the clearest case:
 * "hidden for 2 minutes" sounds damning until you see that half the class never
 * hid the tab at all and the other half did so heavily.
 */

const BAND_ORDER: InsightBand[] = ['typical', 'one', 'two']

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  )
}

export function ClassOverview({ insights }: { insights: GameInsights }) {
  const c = insights.class
  const played = c.playedCount

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">The class</h3>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Stat label="Played" value={`${played} of ${c.rosterCount || played}`} />
        <Stat
          label="Median first try"
          value={c.medianFirstTryAccuracy === null ? '—' : `${Math.round(c.medianFirstTryAccuracy)}%`}
        />
        <Stat label="Median work" value={formatSeconds(c.medianRealWorkSeconds)} />
        <Stat label="Ran out of time" value={String(c.timedOutCount)} />
      </dl>

      {played > 0 && (
        <>
          <div className="mt-4">
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              {BAND_ORDER.map((band) => {
                const n = c.bands[band]
                if (!n) return null
                return (
                  <div
                    key={band}
                    // Math.max keeps a single student from vanishing to a hairline.
                    style={{ width: `${Math.max(2, (n / played) * 100)}%` }}
                    className={
                      band === 'two'
                        ? 'bg-violet-500'
                        : band === 'one'
                          ? 'bg-violet-300'
                          : 'bg-slate-200'
                    }
                  />
                )
              })}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {BAND_ORDER.map((band) => (
                <li key={band} className="flex items-center gap-1.5 text-xs text-slate-600">
                  <span
                    aria-hidden="true"
                    className={`inline-block h-2.5 w-2.5 rounded-sm border ${BAND_SURFACE[band]}`}
                  />
                  {BAND_WORD[band]} — {c.bands[band]}
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            {/* Bimodal, so the median is 0 and says nothing. These are the two
                numbers that actually describe how this class used the tab. */}
            <strong className="font-semibold text-slate-800">{c.neverAwayCount}</strong> of{' '}
            {played} never hid the tab at all
            {c.awayMedianSecondsAmongAway !== null && (
              <>
                ; among those who did, the median was{' '}
                <strong className="font-semibold text-slate-800">
                  {formatSeconds(c.awayMedianSecondsAmongAway)}
                </strong>
              </>
            )}
            .
          </p>

          <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
            Approach: {c.approaches.planner} planned, {c.approaches.trial_and_error} worked by
            trial and error, {c.approaches.steady} steadily.
          </p>
        </>
      )}
    </section>
  )
}

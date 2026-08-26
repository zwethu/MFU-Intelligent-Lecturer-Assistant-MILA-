import type { GameInsights, InsightBand } from '../../../services/gameService'
import { BAND_BAR, BAND_WORD } from './signalBand'
import { formatSeconds } from './signalCopy'

/**
 * How the class did, before any individual.
 *
 * A single student's numbers mean nothing without the room they sat in. The
 * away-time line is the clearest case: "hidden for 2 minutes" sounds damning until
 * you see that half the class never hid the tab at all and the other half did so
 * heavily.
 */

const BAND_ORDER: InsightBand[] = ['two', 'one', 'typical']

/**
 * One number on its own surface.
 *
 * A bordered tile rather than a bare label-over-value, because four bare stats
 * spread across a full-width card read as four unrelated things — nothing tells
 * the eye which label owns which number. Matches ArtifactsTab's summary tiles.
 */
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      {hint && <div className="text-xs text-slate-400">{hint}</div>}
    </div>
  )
}

export function ClassOverview({ insights }: { insights: GameInsights }) {
  const c = insights.class
  const played = c.playedCount

  // Normalised so the segments always total exactly 100%. Without this, three
  // Math.max(2, …) floors can sum past 100 inside an overflow-hidden track, and the
  // segment that gets silently clipped is always the rightmost — the "2 signals"
  // band, which is the one thing this bar exists to show.
  const segments = BAND_ORDER.map((band) => ({ band, n: c.bands[band] })).filter((s) => s.n > 0)
  const totalShown = segments.reduce((sum, s) => sum + s.n, 0) || 1

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">How the class did</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Everyone on the roster for this game, and how their runs compare.
        </p>
      </header>

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Stat
            label="Played"
            value={String(played)}
            hint={`of ${c.rosterCount || played} on the roster`}
          />
          <Stat
            label="Right first time"
            value={c.medianFirstTryAccuracy === null ? '—' : `${Math.round(c.medianFirstTryAccuracy)}%`}
            hint="class median"
          />
          <Stat
            label="Time on the board"
            value={formatSeconds(c.medianRealWorkSeconds)}
            hint="class median, tab-hidden time removed"
          />
          <Stat
            label="Ran out of time"
            value={String(c.timedOutCount)}
            hint={c.timedOutCount === 1 ? 'student' : 'students'}
          />
        </div>

        {played > 0 && (
          <section>
            <h3 className="text-xs font-medium text-slate-500">
              Signals raised, across {played} {played === 1 ? 'run' : 'runs'}
            </h3>
            <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              {segments.map(({ band, n }) => (
                <div
                  key={band}
                  style={{ width: `${(n / totalShown) * 100}%` }}
                  className={`${BAND_BAR[band]} transition-[width] duration-700`}
                />
              ))}
            </div>
            {/* Swatches read from BAND_BAR — the same map that paints the bar — so the
                legend and the chart cannot disagree about which colour means what. */}
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-slate-100 pt-3">
              {BAND_ORDER.map((band) => (
                <li key={band} className="flex items-center gap-1.5 text-xs text-slate-600">
                  <span
                    aria-hidden="true"
                    className={`inline-block h-3 w-3 rounded ${BAND_BAR[band]}`}
                  />
                  {BAND_WORD[band]}
                  <span className="font-semibold tabular-nums text-slate-800">
                    {c.bands[band]}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {played > 0 && (
          <div className="space-y-1.5 border-t border-slate-100 pt-3 text-sm leading-relaxed text-slate-600">
            {/* Away-time is bimodal, so a plain median reads as 0 and says nothing.
                These are the two numbers that actually describe how this class used
                the tab — and the framing matters, because in real data the students
                who left the tab scored better, not worse. */}
            <p>
              <strong className="font-semibold tabular-nums text-slate-800">
                {c.neverAwayCount}
              </strong>{' '}
              of {played} never left the game tab at all
              {c.awayMedianSecondsAmongAway !== null && (
                <>
                  ; the ones who did were away for{' '}
                  <strong className="font-semibold text-slate-800">
                    {formatSeconds(c.awayMedianSecondsAmongAway)}
                  </strong>{' '}
                  in the middle
                </>
              )}
              .
            </p>
            <p>
              <strong className="font-semibold tabular-nums text-slate-800">
                {c.approaches.planner}
              </strong>{' '}
              worked it out before submitting,{' '}
              <strong className="font-semibold tabular-nums text-slate-800">
                {c.approaches.trial_and_error}
              </strong>{' '}
              learned by trying,{' '}
              <strong className="font-semibold tabular-nums text-slate-800">
                {c.approaches.steady}
              </strong>{' '}
              worked steadily.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

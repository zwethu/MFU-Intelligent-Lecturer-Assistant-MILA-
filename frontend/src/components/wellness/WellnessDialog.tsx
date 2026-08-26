import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, Wind } from 'lucide-react'

import { useStress } from '../../context/StressContext'
import { getJournal, type DailyReport } from '../../services/wellnessService'
import { Button, Modal, Spinner } from '../../design-system'
import { levelWord } from './stressLevel'
import { monthKey } from './journalDates'
import { ReportCard } from './ReportCard'

/**
 * The wellness hub, opened by clicking the meter.
 *
 * Two things live here and nothing else: the breathing exercise, and the day
 * you are currently in. The journal is read, never written — it is built from
 * what the lecturer actually did, so there is no mood to pick and no box to
 * fill in at the end of a day that already went badly.
 *
 * It used to carry the whole month: a scrolling stack of day cards with its
 * own month stepper, inside a dialog, inside the page. Three levels of scroll
 * for a history nobody opens the meter to read — they open it to breathe. The
 * month moved to `/journal`, where a calendar can show thirty days at once
 * without a scrollbar, and one button leads there.
 */
export default function WellnessDialog() {
  const navigate = useNavigate()
  const { stress, wellnessOpen, closeWellness, openBreathing } = useStress()
  const [latest, setLatest] = useState<DailyReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      /* Entries come back newest first, and today's in-progress day is first
         of all when there is one — so the head of the list is "the day you are
         in", which is the only one this dialog shows. */
      const data = await getJournal(monthKey(0))
      setLatest(data.entries[0] ?? null)
    } catch (err) {
      console.error('Failed to load wellness journal:', err)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  /* Reload on open. Opening is also what makes the server finalise any day
     that ended since the last look. */
  useEffect(() => {
    if (!wellnessOpen) return
    void load()
  }, [wellnessOpen, load])

  function openJournal() {
    closeWellness()
    navigate('/journal')
  }

  const level = stress?.level ?? 'low'
  const score = Math.round(stress?.stress_score ?? 0)

  return (
    <Modal
      open={wellnessOpen}
      onClose={closeWellness}
      title="Your stress meter"
      eyebrow={`${levelWord(level)} · ${score}/100`}
      size="md"
      footer={<Button variant="secondary" onClick={closeWellness}>Close</Button>}
    >
      <div data-stress-ui className="space-y-5">
        <section>
          <Button block onClick={openBreathing}>
            <Wind className="h-4 w-4" aria-hidden="true" />
            {stress?.breathing_used_today ? 'Breathe again' : 'Start breathing exercise'}
          </Button>
          <p className="mt-1.5 text-center text-[11px] text-slate-500">
            {stress?.breathing_used_today
              ? 'Today’s reset is used. Breathing still helps, and the meter eases off on its own while you are away.'
              : '~40 seconds · breathing can bring your stress down a little, once a day'}
          </p>
        </section>

        <section className="border-t border-slate-100 pt-4">
          <h3 className="mb-2.5 text-sm font-semibold text-slate-800">Latest day</h3>

          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner size={22} />
            </div>
          ) : failed ? (
            <p className="py-6 text-center text-xs text-slate-500">
              Could not load your journal.{' '}
              <button type="button" onClick={() => void load()} className="font-semibold text-violet-700 hover:underline">
                Try again
              </button>
            </p>
          ) : latest ? (
            <ReportCard report={latest} />
          ) : (
            <p className="py-6 text-center text-xs text-slate-500">
              Nothing recorded yet this month. Your days are written here on their
              own, from the work you do.
            </p>
          )}

          <button
            type="button"
            onClick={openJournal}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-2 text-xs font-semibold text-slate-600 transition-colors hover:border-violet-200 hover:bg-violet-50/60 hover:text-violet-700"
          >
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            See every day in the journal
          </button>
        </section>
      </div>
    </Modal>
  )
}

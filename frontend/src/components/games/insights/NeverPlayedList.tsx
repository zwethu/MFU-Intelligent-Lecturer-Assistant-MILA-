import { useEffect, useState } from 'react'
import { Check, Copy, UserCheck } from 'lucide-react'

import type { StudentInsight } from '../../../services/gameService'

/**
 * The roster rows with no attempt.
 *
 * This is the reason the CSV was built roster-first rather than attempts-first —
 * "who still has not played" is a question an attempts-only export cannot answer.
 * The copy button is what turns the answer into the next action: the doc says
 * "chase him", and copying the addresses is the chase.
 */
export function NeverPlayedList({ students }: { students: StudentInsight[] }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  const emails = students.map((s) => s.email).filter(Boolean)

  if (students.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
        <UserCheck className="mx-auto h-8 w-8 text-slate-300" />
        <p className="mt-3 text-sm font-medium text-slate-700">
          Everyone on the roster played.
        </p>
        <p className="mt-1 text-sm text-slate-500">Nothing to chase.</p>
      </div>
    )
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(emails.join(', '))
      setCopied(true)
    } catch {
      // Clipboard can be blocked; the addresses are on screen and selectable.
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            {students.length} {students.length === 1 ? 'student' : 'students'} never opened it
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            On the roster with no attempt recorded. The link may not have reached them.
          </p>
        </div>
        {emails.length > 0 && (
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {copied ? (
              <Check className="h-4 w-4 text-emerald-600" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {copied ? 'Copied' : `Copy ${emails.length} email ${emails.length === 1 ? 'address' : 'addresses'}`}
          </button>
        )}
      </header>
      <ul className="divide-y divide-slate-100">
        {students.map((student) => (
          <li key={student.playerUid || student.email} className="px-4 py-2.5">
            <p className="text-sm font-medium text-slate-800">
              {student.rosterName || student.email}
            </p>
            {student.rosterName && (
              <p className="text-xs text-slate-500">{student.email}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

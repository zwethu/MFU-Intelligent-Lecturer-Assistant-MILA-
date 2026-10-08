import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import axios from 'axios'

import { MilaLogo } from '../components/brand/MilaLogo'
import { MilaWord } from '../components/brand/MilaWord'
import { Button } from '../design-system'
import { useAuth } from '../hooks/useAuth'
import api from '../lib/api'
import LoadingScreen from '../components/ui/LoadingScreen'

/**
 * Tester sign-up.
 *
 * A Google account that is not on the lecturer allowlist lands here after
 * sign-in, with a single-use ticket the backend minted from the address Google
 * verified. Nothing is typed: name and email are shown as they came from
 * Google, and one checkbox is the whole ask. Confirming adds the address to the
 * allowlist and hands back a custom token, which /auth/callback signs in with
 * exactly as it does for a normal lecturer.
 */

type Applicant = { email: string; name: string }

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; applicant: Applicant }
  | { kind: 'invalid'; message: string }

function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const detail = err.response?.data?.detail
    if (typeof detail === 'string') return detail
  }
  return 'Something went wrong. Please sign in again.'
}

export default function JoinTester() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { signInWithGoogle } = useAuth()
  const ticket = searchParams.get('ticket') ?? ''

  const [state, setState] = useState<State>({ kind: 'loading' })
  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!ticket) {
      setState({ kind: 'invalid', message: 'This sign-up link is invalid. Please sign in again.' })
      return
    }
    let cancelled = false
    api
      .get<Applicant>(`/auth/tester-signup/${encodeURIComponent(ticket)}`)
      .then(({ data }) => {
        if (!cancelled) setState({ kind: 'ready', applicant: data })
      })
      .catch((err) => {
        if (!cancelled) setState({ kind: 'invalid', message: errorMessage(err) })
      })
    return () => {
      cancelled = true
    }
  }, [ticket])

  async function join() {
    setSubmitting(true)
    try {
      const { data } = await api.post<{ custom_token: string }>('/auth/tester-signup', { ticket })
      navigate(`/auth/callback?${new URLSearchParams({ custom_token: data.custom_token })}`, {
        replace: true,
      })
    } catch (err) {
      // The ticket is burned on the first attempt, so a retry here would only
      // fail again — send them back through sign-in instead.
      setState({ kind: 'invalid', message: errorMessage(err) })
      setSubmitting(false)
    }
  }

  if (state.kind === 'loading') return <LoadingScreen label="Checking your sign-up link…" />

  return (
    <div className="academic-bg fixed inset-0 flex items-center justify-center overflow-y-auto px-4 py-10 font-sans">
      <div className="login-card w-full max-w-md rounded-3xl px-6 py-10 sm:px-10">
        <div className="mb-8">
          <MilaLogo height={38} />
        </div>

        {state.kind === 'invalid' ? (
          <>
            <h1 className="font-display text-2xl font-bold leading-tight text-slate-900">
              This link has expired
            </h1>
            <p role="alert" className="mt-3 text-sm leading-relaxed text-slate-600">
              {state.message}
            </p>
            <Button type="button" size="lg" block className="mt-8" onClick={signInWithGoogle}>
              Sign in again
            </Button>
          </>
        ) : (
          <>
            <h1 className="font-display text-2xl font-bold leading-tight text-slate-900">
              Become a <MilaWord className="text-violet-600" /> tester
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              This Google account isn't on the lecturer list yet. Join as a tester to try MILA
              straight away.
            </p>

            <dl className="mt-6 space-y-3 rounded-2xl border border-white/70 bg-white/70 p-5 text-sm shadow-sm">
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-700">Name</dt>
                <dd className="mt-0.5 font-medium text-slate-900">{state.applicant.name || '—'}</dd>
              </div>
              <div>
                <dt className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-700">Email</dt>
                <dd className="mt-0.5 break-all font-medium text-slate-900">{state.applicant.email}</dd>
              </div>
            </dl>

            <label className="mt-6 flex cursor-pointer items-start gap-2.5 text-sm leading-snug text-slate-700">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(event) => setAgreed(event.target.checked)}
                className="mt-0.5 h-4 w-4 flex-none cursor-pointer accent-violet-600"
              />
              <span id="tester-agree-label">I want to become a MILA tester</span>
            </label>

            <Button
              type="button"
              onClick={join}
              loading={submitting}
              disabled={!agreed}
              aria-describedby="tester-agree-label"
              size="lg"
              block
              className="mt-4 disabled:!bg-slate-200 disabled:!text-slate-500 disabled:!opacity-100 disabled:!shadow-none"
            >
              {submitting ? 'Setting up your account…' : 'Join as tester'}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

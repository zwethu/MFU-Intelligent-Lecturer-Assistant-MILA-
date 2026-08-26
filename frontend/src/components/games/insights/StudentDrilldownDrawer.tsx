import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

import { useExitDelay } from '../../../hooks/useExitDelay'
import type { GameInsights, StudentInsight } from '../../../services/gameService'
import { StudentDrilldown, StudentDrilldownHeader } from './StudentDrilldown'

/**
 * One student's detail, as a slide-over — the narrow-screen half of the
 * follow-the-reader layout.
 *
 * On a wide screen the detail card is pinned beside the list, so clicking a row
 * near the bottom needs no scrolling. There is no room for that below `lg`, so
 * the same card arrives over the page instead. Either way the reader never has
 * to scroll back up to see what they just clicked, which was the whole problem.
 *
 * Modelled on `components/ui/ConfirmDialog.tsx` rather than ChatSidePanel: it is
 * the one dialog in this app that gets focus restore, initial focus and a real
 * Tab trap. Motion is the app's `@starting-style` + `data-leaving` idiom, so the
 * browser owns the enter frame and there is no hand-rolled rAF staging.
 */

/** Must match `.mila-drawer[data-leaving]` in index.css. */
const DRAWER_EXIT_MS = 140

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function StudentDrilldownDrawer({
  student,
  insights,
  open,
  onClose,
}: {
  student: StudentInsight | null
  insights: GameInsights
  open: boolean
  onClose: () => void
}) {
  const mounted = useExitDelay(open, DRAWER_EXIT_MS)
  const panelRef = useRef<HTMLElement>(null)

  /* The last student shown, so the panel can still draw itself on the way out.
     Written during render because the exit starts on the frame selection could
     clear, and an effect would blank the card before it finished leaving. */
  const last = useRef<StudentInsight | null>(null)
  if (student) last.current = student
  const shown = last.current

  /* Put focus back where it came from. Without this, closing drops focus to
     <body> and the next Tab restarts at the top of the page — a keyboard user
     loses the row they were on every single time. */
  useEffect(() => {
    if (!open) return undefined
    const opener = document.activeElement as HTMLElement | null
    // preventScroll for the same reason this panel exists: focus() scrolls every
    // scrollable ancestor by default, which is the jump BatchTabs documents.
    return () => opener?.focus?.({ preventScroll: true })
  }, [open])

  /* Initial focus on Close — the one control that always exists here. */
  useEffect(() => {
    if (!open) return
    panelRef.current
      ?.querySelector<HTMLElement>('[data-drilldown-close]')
      ?.focus({ preventScroll: true })
  }, [open])

  /**
   * Escape, and trap Tab inside the panel.
   *
   * `aria-modal` tells a screen reader the rest of the page is gone; it does
   * nothing to the tab order, so without this Tab walks straight out of the
   * drawer and into the list it is covering.
   */
  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const stops = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
      if (stops.length === 0) return
      const first = stops[0]
      const final = stops[stops.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault()
        final.focus({ preventScroll: true })
      } else if (!event.shiftKey && active === final) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  /* Kept for consistency with the app's other dialogs, though what actually
     stops the page scrolling underneath is the portal: it mounts to <body>,
     outside AppLayout's overflow-y-auto div, which is the real scroller here. */
  useEffect(() => {
    if (!open) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  if (!mounted || !shown) return null

  const leaving = !open
  const name = shown.rosterName || shown.nickname || shown.email || 'Student'

  return createPortal(
    <div
      className="mila-dialog-backdrop fixed inset-0 z-[200] flex justify-end"
      data-leaving={leaving || undefined}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${name} — run detail`}
        data-leaving={leaving || undefined}
        className="mila-drawer flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur">
          <StudentDrilldownHeader student={shown} />
          <button
            type="button"
            data-drilldown-close
            onClick={onClose}
            aria-label="Close student detail"
            className="flex-shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <StudentDrilldown student={shown} insights={insights} />
      </aside>
    </div>,
    document.body,
  )
}

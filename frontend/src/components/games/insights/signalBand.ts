import type { ApproachId, FlagId, InsightBand } from '../../../services/gameService'

/**
 * How a band reads on screen. Presentation only.
 *
 * This file deliberately exports **no function that takes a number**. The band is
 * decided once, in Python, and arrives on the payload; there is nothing here to
 * re-derive and therefore nothing that can drift out of step with the evidence
 * printed beside it. That failure — a bar painted from one derivation and a word
 * from another, so the meter reads "high" next to the word "Low" — is the exact
 * thing `components/wellness/stressLevel.ts` was written to warn about.
 *
 * One hue, three depths. This is a considered departure from the stress meter's
 * green→amber→red ramp, which is right when high means bad. Here high means
 * *unusual*, and painting an unusual student red is precisely the accusation this
 * panel exists to avoid. Alarm colours stay available for the help-needed flags
 * below, where they are earned.
 */
export const BAND_SURFACE: Record<InsightBand, string> = {
  typical: 'border-slate-200 bg-slate-50 text-slate-700',
  one: 'border-violet-200 bg-violet-50 text-violet-800',
  two: 'border-violet-300 bg-violet-100 text-violet-900',
}

/** The word carries the count. Never an adjective — "unusual" is a judgement. */
export const BAND_WORD: Record<InsightBand, string> = {
  typical: 'Nothing stood out',
  one: '1 signal',
  two: '2 signals',
}

/** Spoken form, so a screen reader gets a sentence rather than a bare number. */
export function bandAriaLabel(name: string, band: InsightBand, total: number): string {
  if (band === 'typical') {
    return `${name}: none of the ${total} signals this game can measure.`
  }
  const count = band === 'two' ? 2 : 1
  return `${name}: ${count} of the ${total} signals this game can measure.`
}

/**
 * Flags are about needing help, so they may use alarm colour — but every one
 * still ships a word AND an icon name, never colour alone: a red border is
 * invisible to roughly one reader in eight (see ui/fieldStyles.ts).
 */
export const FLAG_STYLE: Record<FlagId, { label: string; cls: string }> = {
  ran_out_of_time: {
    label: 'Ran out of time',
    cls: 'border-amber-200 bg-amber-50 text-amber-800',
  },
  high_rework: {
    label: 'Lots of resubmits',
    cls: 'border-amber-200 bg-amber-50 text-amber-800',
  },
  struggling: {
    label: 'Struggled with the material',
    cls: 'border-red-200 bg-red-50 text-red-800',
  },
  never_played: {
    label: 'Never opened it',
    cls: 'border-slate-200 bg-slate-100 text-slate-700',
  },
}

export const APPROACH_WORD: Record<ApproachId, string> = {
  planner: 'Planner',
  trial_and_error: 'Trial and error',
  steady: 'Steady',
}

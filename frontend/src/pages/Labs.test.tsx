// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Labs, { buildMessage } from './Labs'

const listArtifacts = vi.fn()
const generate = vi.fn()

// Keep lib/firebase.ts out of the module graph (see TermsGate.test.tsx):
// initializeAuth() asserts under jsdom and there is no vitest setup file.
vi.mock('../lib/firebase', () => ({ app: {}, auth: {}, db: {}, rtdb: {} }))
vi.mock('../services/artifactService', () => ({
  listArtifacts: (...args: unknown[]) => listArtifacts(...args),
}))
vi.mock('../hooks/useBatchSelection', () => ({
  useBatchSelection: () => ({
    batches: [{ id: 'b1', batch_name: 'ST 26', course_name: 'Software Testing' }],
    loading: false,
    selectedBatch: { id: 'b1', batch_name: 'ST 26', course_name: 'Software Testing' },
    selectedBatchId: 'b1',
    setSelectedBatchId: vi.fn(),
  }),
}))
vi.mock('../hooks/useWorkflowPrefill', () => ({ useWorkflowPrefill: () => null }))
vi.mock('../hooks/useGenerationRun', () => ({
  useGenerationRun: () => ({
    messages: [], runStates: {}, currentRunId: null, sending: false,
    pendingAttachments: [], attachmentsUploading: false, attachmentErrors: [],
    generate, removePendingAttachment: vi.fn(), uploadAttachmentFiles: vi.fn(),
    reset: vi.fn(), cancelRun: vi.fn(),
  }),
}))
vi.mock('../components/generation/PlanHintBanner', () => ({ PlanHintBanner: () => null }))
vi.mock('../components/generation/GenerationAttachments', () => ({ GenerationAttachments: () => null }))
vi.mock('../components/generation/GenerationRunView', () => ({ GenerationRunView: () => null }))

afterEach(cleanup)
beforeEach(() => {
  generate.mockReset()
  listArtifacts.mockReset().mockResolvedValue([
    {
      id: 'l1', type: 'lab', title: 'Week 2 — Guestbook', week: 2, version: 1,
      updated_at: '2026-08-01T09:00:00Z', doc_url: 'https://docs.example/lecturer',
      metadata: { student_doc_url: 'https://docs.example/student' },
    },
  ])
})

const renderPage = () => render(<MemoryRouter><Labs /></MemoryRouter>)

describe('the Labs page', () => {
  /**
   * The message must carry the four arguments `begin_lab_workflow` takes —
   * week, topic, duration_minutes, lab_modality — plus the standalone marker
   * that tells the agent not to ask clarifying questions.
   */
  it('submits a lab.generate run whose message names every required tool input', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: /Generate outline/ }))

    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    const call = generate.mock.calls[0][0]
    expect(call.workflowType).toBe('lab')
    expect(call.week).toBe(1)
    expect(call.message).toContain('Standalone form submission')
    expect(call.message).toContain('begin_lab_workflow')
    expect(call.message).toMatch(/week 1/)
    expect(call.message).toMatch(/^Topic:/m)
    expect(call.message).toContain('duration_minutes=90')
    expect(call.message).toMatch(/lab_modality/)
  })

  it('names the modality verbatim from the enum when one is picked', () => {
    const message = buildMessage({
      title: '', topic: 'Firebase guestbook', week: 3, duration: 120, modality: 'wet_lab', difficulty: 'hard',
      groupSize: 'pairs', studentLevel: 'beginner', instructions: '',
    })
    expect(message).toContain('lab_modality=wet_lab')
    expect(message).toContain('Topic: Firebase guestbook')
    expect(message).toContain('Group size: pairs')
    expect(message).toContain('Difficulty: hard')
  })

  it('links both documents a lab exports', async () => {
    renderPage()
    expect(await screen.findByRole('link', { name: /Lecturer guide/ })).toHaveProperty('href', 'https://docs.example/lecturer')
    expect(screen.getByRole('link', { name: /Student instructions/ })).toHaveProperty('href', 'https://docs.example/student')
    expect(listArtifacts).toHaveBeenCalledWith('b1', { type: 'lab', current: true })
  })
})

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, ExternalLink, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import type { ToastMessage } from '../types'
import Toast from '../components/ui/Toast'
import { getErrorMessage } from '../utils/errors'
import { useBatchSelection } from '../hooks/useBatchSelection'
import { useWorkflowPrefill } from '../hooks/useWorkflowPrefill'
import { useGenerationRun } from '../hooks/useGenerationRun'
import { GenerationRunView } from '../components/generation/GenerationRunView'
import { deriveGenerationStage, isWorkflowSettled } from '../components/generation/generationStage'
import { GenerationAttachments } from '../components/generation/GenerationAttachments'
import { PlanHintBanner } from '../components/generation/PlanHintBanner'
import { deleteArtifact, listArtifacts, type Artifact } from '../services/artifactService'
import { timeAgo } from '../utils/formatDate'
import { artifactIcon } from '../utils/artifactIcons'
import { SelectField, toOptions } from '../components/ui/SelectField'
import { NumberField } from '../components/ui/NumberField'
import { Collapse } from '../components/ui/Collapse'
import { confirm } from '../components/ui/confirmStore'
import { undoable, usePendingUndo } from '../components/ui/undoStore'
import { FIELD_CLASS, FIELD_LABEL_CLASS, TEXTAREA_CLASS } from '../components/ui/fieldStyles'
import { Spinner } from '../design-system'

const LabIcon = artifactIcon('lab')

/* The four values `begin_lab_workflow` takes are week, topic, duration_minutes
   and lab_modality (Pnai-ai/mila/agents/lab/workers/begin_workflow.py). Every
   one of them is always sent — topic falls back to "derive from the course
   plan", which the agent's standalone path accepts. */
const DURATIONS = [60, 90, 120, 180]
// LabModality enum, verbatim (mila/agents/lab/schemas.py).
const MODALITIES = [
  'coding_virtual', 'data_analysis', 'simulation', 'hardware_physical',
  'wet_lab', 'field_observation', 'design_workshop',
]
const AUTO_MODALITY = 'auto'
const DIFFICULTIES = ['easy', 'medium', 'hard']
const STUDENT_LEVELS = ['unspecified', 'beginner', 'intermediate', 'advanced']

const DURATION_OPTIONS = toOptions(DURATIONS.map(String))
const MODALITY_OPTIONS = [
  { value: AUTO_MODALITY, label: 'Let MILA choose' },
  ...toOptions(MODALITIES, (m) => m.replace(/_/g, ' ')),
]
const DIFFICULTY_OPTIONS = toOptions(DIFFICULTIES, (d) => d[0].toUpperCase() + d.slice(1))
const STUDENT_LEVEL_OPTIONS = toOptions(STUDENT_LEVELS, (l) => l[0].toUpperCase() + l.slice(1))

const INITIAL_FORM = {
  title: '',
  topic: '',
  week: 1,
  duration: 90,
  modality: AUTO_MODALITY,
  difficulty: 'medium',
  groupSize: '',
  studentLevel: 'unspecified',
  instructions: '',
}

export function buildMessage(f: typeof INITIAL_FORM): string {
  const lines = [
    `Generate a lab for week ${f.week}.`,
    // Standalone form already collected required fields — do not ask follow-up questions.
    'Standalone form submission: all required fields below are confirmed. Do not ask clarifying questions; proceed to begin_lab_workflow.',
  ]
  if (f.title.trim()) lines.push(`Preferred lab title: ${f.title.trim()}`)
  else {
    lines.push(
      'Preferred lab title: not specified — auto-name the lab. If an active Course Plan exists, derive the title from that week\'s theme/goal; otherwise name it from the topic and course.',
    )
  }
  if (f.topic.trim()) lines.push(`Topic: ${f.topic.trim()}`)
  else {
    lines.push(
      'Topic: not specified — derive the topic for this week from the active Course Plan week guidance if available; otherwise pick a suitable topic for the course.',
    )
  }
  lines.push(`Duration: ${f.duration} minutes (duration_minutes=${f.duration})`)
  if (f.modality === AUTO_MODALITY) {
    lines.push(
      'Lab modality: not specified — infer lab_modality from the course plan and course materials (never default to coding_virtual for a non-programming course) and state the chosen modality in the outline so the lecturer can correct it.',
    )
  } else {
    lines.push(`Lab modality: ${f.modality} (lab_modality=${f.modality})`)
  }
  lines.push(`Difficulty: ${f.difficulty}`)
  if (f.groupSize.trim()) lines.push(`Group size: ${f.groupSize.trim()}`)
  if (f.studentLevel !== 'unspecified') lines.push(`Expected student level: ${f.studentLevel}`)
  if (f.instructions.trim()) lines.push(`Additional instructions: ${f.instructions.trim()}`)
  lines.push(
    'If course_blueprint_status is active, you MUST reference the Course Plan (especially course_blueprint_week_plan and course_blueprint_lab_strategy) when choosing topic/title and aligning objectives.',
  )
  return lines.join('\n')
}

// Required inputs only. Duration and modality are selects with a value always
// set, so week and batch are the only things that can be missing.
function missingRequiredInputs(f: typeof INITIAL_FORM, hasBatch: boolean): string[] {
  const missing: string[] = []
  if (!hasBatch) missing.push('a batch')
  if (!(Number(f.week) >= 1)) missing.push('a week number')
  return missing
}

function joinReadable(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

// A lab exports two documents: `doc_url` is the lecturer guide, and the
// student instructions live in metadata (same lookup as ArtifactsTab).
function studentDocUrl(a: Artifact): string {
  const value = a.metadata?.student_doc_url
  return typeof value === 'string' ? value : ''
}

export default function Labs() {
  const { batches, loading: batchesLoading, selectedBatch, selectedBatchId, setSelectedBatchId } =
    useBatchSelection()
  const run = useGenerationRun(selectedBatch, 'lab')

  const [form, setForm] = useState(INITIAL_FORM)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const pendingUndo = usePendingUndo()
  const [listLoading, setListLoading] = useState(true)
  const [showOptional, setShowOptional] = useState(false)
  const prefill = useWorkflowPrefill(selectedBatchId, listLoading ? null : artifacts)
  const prefilledFor = useRef('')

  const batchOptions = useMemo(
    () => batches.map((b) => ({ value: b.id, label: b.batch_name, hint: b.course_name })),
    [batches],
  )

  useEffect(() => {
    if (!prefill || !selectedBatchId || prefilledFor.current === selectedBatchId) return
    prefilledFor.current = selectedBatchId
    setForm((current) => ({
      ...current,
      week: prefill.week,
      topic: current.topic || prefill.topic,
    }))
  }, [prefill, selectedBatchId])

  const showToast = useCallback((type: ToastMessage['type'], message: string) => {
    setToast({ type, message })
    window.setTimeout(() => setToast(null), 5000)
  }, [])

  async function handleDeleteArtifact(artifact: Artifact) {
    const batchId = selectedBatchId
    if (!batchId) return
    const label = artifact.title || 'this lab'
    const ok = await confirm({
      title: `Delete ${label}?`,
      body: 'This removes it from MILA and deletes its Google Docs. Both the Lecturer Guide and the Student Instructions go.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    undoable({
      id: artifact.id,
      message: `Deleted ${label}.`,
      commit: async () => {
        try {
          await deleteArtifact(batchId, artifact.id, true)
          setArtifacts((prev) => prev.filter((entry) => entry.id !== artifact.id))
        } catch (err) {
          showToast('error', getErrorMessage(err, 'Could not delete it.'))
        }
      },
    })
  }

  const visibleArtifacts = artifacts.filter((a) => !pendingUndo.has(a.id))

  const refreshArtifacts = useCallback(async (batchId: string) => {
    setListLoading(true)
    try {
      const data = await listArtifacts(batchId, { type: 'lab', current: true })
      setArtifacts(data)
    } catch (err) {
      console.error(err)
      showToast('error', getErrorMessage(err, 'Could not load labs.'))
    } finally {
      setListLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    if (selectedBatchId) {
      void refreshArtifacts(selectedBatchId)
      return
    }
    setArtifacts([])
    setListLoading(false)
  }, [selectedBatchId, refreshArtifacts])

  async function handleGenerate(e: FormEvent) {
    e.preventDefault()
    if (!selectedBatch || run.sending) return
    const blockers = missingRequiredInputs(form, true)
    if (blockers.length > 0) {
      showToast('error', `Add ${joinReadable(blockers)} before generating.`)
      return
    }
    await run.generate({
      workflowType: 'lab',
      message: buildMessage(form),
      week: Number(form.week) || 1,
      webSearch: true,
    })
  }

  const discardRun = useCallback(async () => {
    const ok = await confirm({
      title: 'Discard this draft?',
      body: 'Nothing has been saved, and you will start again from the form.',
      confirmLabel: 'Discard',
      tone: 'danger',
    })
    if (!ok) return
    if (run.currentRunId) void run.cancelRun()
    run.reset()
  }, [run])

  const stage = deriveGenerationStage(run).stage
  const settled = isWorkflowSettled(stage)

  const settledRef = useRef(false)
  useEffect(() => {
    if (settled && !settledRef.current && selectedBatchId) void refreshArtifacts(selectedBatchId)
    settledRef.current = settled
  }, [settled, selectedBatchId, refreshArtifacts])

  // Same guard as LessonPlans: a persisted run id with nothing left in it
  // must not hide the form behind an idle run view.
  const started =
    (run.messages.length > 0 || Boolean(run.currentRunId)) && (stage !== 'idle' || run.sending)
  const missing = missingRequiredInputs(form, Boolean(selectedBatch))

  return (
    <div className="pb-8">
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Labs</h1>
        <p className="text-sm text-slate-500 mt-1">
          Generate a lab — lecturer guide and student instructions — from the batch’s course materials, web search, and any attachments.
        </p>
      </div>

      <PlanHintBanner batchId={selectedBatchId} />

      {started && selectedBatch ? (
        <div>
          <div
            className={`flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm ${
              settled ? '' : 'min-h-[24rem]'
            }`}
          >
            <GenerationRunView
              batch={selectedBatch}
              run={run}
              accent="primary"
              onDiscard={discardRun}
              onGenerateAnother={() => run.reset()}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <form onSubmit={handleGenerate} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
            <SelectField
              label="Batch"
              value={selectedBatchId ?? ''}
              onChange={setSelectedBatchId}
              options={batchOptions}
              disabled={batchesLoading}
              placeholder={batchesLoading ? 'Loading batches…' : 'Select a batch'}
            />

            {prefill?.source === 'course-plan' && (
              <p className="text-xs text-slate-500">
                Prefilled from your Course Plan for week {prefill.week} — the topic comes from that week.
                Change anything that does not fit.
              </p>
            )}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <NumberField
                label="Week"
                min={1}
                required
                value={form.week}
                onChange={(week) => setForm((f) => ({ ...f, week }))}
              />
              <SelectField
                label="Duration (min)"
                value={String(form.duration)}
                onChange={(v) => setForm((f) => ({ ...f, duration: Number(v) }))}
                options={DURATION_OPTIONS}
              />
              <SelectField
                label="Lab type"
                value={form.modality}
                onChange={(v) => setForm((f) => ({ ...f, modality: v }))}
                options={MODALITY_OPTIONS}
              />
              <SelectField
                label="Difficulty"
                value={form.difficulty}
                onChange={(v) => setForm((f) => ({ ...f, difficulty: v }))}
                options={DIFFICULTY_OPTIONS}
              />
            </div>

            <div>
              <button
                type="button"
                onClick={() => setShowOptional((v) => !v)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-violet-700 hover:text-violet-800"
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${showOptional ? 'rotate-180' : ''}`} />
                {showOptional ? 'Hide optional details' : 'Show optional details'}
              </button>
              <Collapse open={showOptional}>
                <div className="mt-3 space-y-3 rounded-lg border border-slate-100 bg-slate-50/70 p-3">
                  <div>
                    <label className={FIELD_LABEL_CLASS}>Lab name</label>
                    <input type="text" value={form.title}
                      onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                      placeholder="Leave blank — agent names it from the course plan or topic"
                      className={FIELD_CLASS} />
                  </div>
                  <div>
                    <label className={FIELD_LABEL_CLASS}>Topic</label>
                    <input type="text" value={form.topic}
                      onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))}
                      placeholder="Leave blank to let the agent choose from the course plan"
                      className={FIELD_CLASS} />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className={FIELD_LABEL_CLASS}>Group size</label>
                      <input type="text" value={form.groupSize}
                        onChange={(e) => setForm((f) => ({ ...f, groupSize: e.target.value }))}
                        placeholder="e.g. pairs, or 3–4"
                        className={FIELD_CLASS} />
                    </div>
                    <SelectField
                      label="Student level"
                      value={form.studentLevel}
                      onChange={(v) => setForm((f) => ({ ...f, studentLevel: v }))}
                      options={STUDENT_LEVEL_OPTIONS}
                    />
                  </div>
                  <div>
                    <label className={FIELD_LABEL_CLASS}>Additional instructions</label>
                    <textarea rows={2} value={form.instructions}
                      onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
                      placeholder="Anything else the agent should consider…"
                      className={TEXTAREA_CLASS} />
                  </div>
                </div>
              </Collapse>
            </div>

            {selectedBatch && <GenerationAttachments run={run} />}
            <p className="text-xs text-slate-400">
              Course materials for the selected batch are always used.
            </p>

            <div>
              <button type="submit" disabled={run.sending || missing.length > 0}
                className="inline-flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md text-white bg-violet-600 hover:bg-violet-700 shadow-sm transition-colors disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:cursor-not-allowed">
                {run.sending ? <Spinner tone="inverse" size={16} /> : <Sparkles className="w-4 h-4" />}
                Generate outline
              </button>
              {missing.length > 0 && !run.sending && (
                <p className="mt-2 text-center text-xs text-slate-500">
                  Add {joinReadable(missing)} to continue.
                </p>
              )}
            </div>
          </form>
        </div>
      )}

      <div className="mt-6 min-w-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-700">Saved labs</h2>
          {selectedBatchId && (
            <button
              type="button"
              onClick={() => void refreshArtifacts(selectedBatchId)}
              disabled={listLoading}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${listLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          )}
        </div>
        {listLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 py-6">
            <Spinner size={16} /> Loading…
          </div>
        ) : visibleArtifacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center rounded-xl border border-slate-100 bg-white">
            <LabIcon className="w-8 h-8 text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">No labs yet for this batch.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {visibleArtifacts.map((a) => (
              <article key={a.id} className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-3 mb-2">
                  <div className="h-9 w-9 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center border border-violet-100">
                    <LabIcon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-slate-900 truncate">{a.title || 'Lab'}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Week {a.week ?? '—'} · v{a.version ?? 1}</p>
                  </div>
                </div>
                <p className="text-xs text-slate-400 mb-3">{timeAgo(a.updated_at ? new Date(a.updated_at) : null)}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {a.doc_url && (
                    <a href={a.doc_url} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 text-slate-700 transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-800">
                      <ExternalLink className="w-3.5 h-3.5" /> Lecturer guide
                    </a>
                  )}
                  {studentDocUrl(a) && (
                    <a href={studentDocUrl(a)} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 text-slate-700 transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-800">
                      <ExternalLink className="w-3.5 h-3.5" /> Student instructions
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleDeleteArtifact(a)}
                    className="ml-auto flex-shrink-0 rounded-md p-2 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                    aria-label={`Delete ${a.title || 'lab'}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

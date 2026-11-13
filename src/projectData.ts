import { useEffect, useMemo, useState } from 'react'
import { snapshotOf, type ExamSnapshot } from './engine/actions.ts'
import { stemKey, type ItemSummary, type Parsed } from './engine/importer.ts'
import { SAMPLES } from './engine/sample.ts'
import { analyze, impact, rescore } from './engine/stats.ts'
import type { Adjustment, Attempt, Exam } from './engine/types.ts'
import { getAttempts, getPrefs, getProjects, putAttempts, saveProject, uuid, type ExamMeta, type Project } from './store.ts'

export async function createBlankProject(name: string, course = ''): Promise<Project> {
  const now = Date.now()
  return saveProject({ id: uuid(), name, course, createdAt: now, updatedAt: now, salt: uuid(), exams: [], bands: getPrefs().bands })
}

export async function createSampleProject(sampleId: string): Promise<Project> {
  const existing = getProjects().find(p => p.sampleId === sampleId)
  if (existing) return existing
  const def = SAMPLES.find(s => s.id === sampleId)!
  const now = Date.now()
  const exams: ExamMeta[] = []
  for (const e of def.exams()) {
    const id = uuid()
    await putAttempts(id, e.exam.attempts)
    exams.push({ id, title: e.title, term: e.term, date: e.date, format: 'generic', fileName: 'synthetic.csv', importedAt: now, items: e.exam.items, adjustments: [], snapshot: snapshotOf(e.exam, [], { id, title: e.title, term: e.term, date: e.date }), gradeItem: e.title, outOf: e.exam.items.reduce((s, i) => s + i.maxPoints, 0), note: e.note })
  }
  return saveProject({ id: uuid(), name: def.name, course: def.course, createdAt: now, updatedAt: now, salt: sampleId, exams, bands: getPrefs().bands, sampleId })
}

export interface ExamInfo { title: string; term: string; date: string; fileName: string; dropNames: boolean }

export async function addExam(p: Project, parsed: Parsed, info: ExamInfo): Promise<{ project: Project; examId: string }> {
  const id = uuid()
  let meta: ExamMeta
  if (parsed.summary) {
    meta = { id, ...info, format: parsed.format, importedAt: Date.now(), items: [], adjustments: [], summaryOnly: true, snapshot: summarySnapshot(parsed.summary, { id, ...info }) }
  } else {
    const attempts = info.dropNames ? parsed.exam.attempts.map(dropName) : parsed.exam.attempts
    await putAttempts(id, attempts)
    const exam = { items: parsed.exam.items, attempts }
    meta = { id, ...info, format: parsed.format, importedAt: Date.now(), items: exam.items, adjustments: [], snapshot: snapshotOf(exam, [], { id, ...info }), gradeItem: info.title, outOf: getPrefs().outOf, namesDropped: info.dropNames }
  }
  const project = await saveProject({ ...p, exams: [...p.exams, meta] })
  return { project, examId: id }
}

const dropName = (a: Attempt): Attempt => { const { name: _n, ...rest } = a; return rest }

function summarySnapshot(rows: ItemSummary[], meta: Pick<ExamSnapshot, 'id' | 'title' | 'term' | 'date'>): ExamSnapshot {
  const n = Math.max(0, ...rows.map(r => r.n))
  return {
    ...meta, createdAt: Date.now(), n, k: rows.length, alpha: null, kr20: null, sem: null, meanPct: rows.length ? (rows.reduce((s, r) => s + r.p, 0) / rows.length) * 100 : 0, medianPct: 0, adjustments: [], summaryOnly: true,
    items: rows.map(r => ({ bankKey: r.stem ? stemKey(r.stem) : r.label, label: r.label, stem: r.stem, p: r.p, d: r.d ?? null, r: r.r, flags: [] })).map(i => ({ ...i, maxPoints: 1 })),
  }
}

/** Saves a change to one exam and refreshes its statistics snapshot. */
export async function updateExam(p: Project, examId: string, patch: Partial<ExamMeta>, attempts?: Attempt[]) {
  const e = p.exams.find(x => x.id === examId)!
  const next = { ...e, ...patch }
  if (!next.summaryOnly) {
    const rows = attempts ?? (await getAttempts(examId))
    if (rows) next.snapshot = snapshotOf({ items: next.items, attempts: rows }, next.adjustments, next)
  }
  return saveProject({ ...p, exams: p.exams.map(x => (x.id === examId ? next : x)) })
}

/** Loads one exam's student rows and runs the analysis, before and after regrades. */
export function useExam(p: Project | undefined, examId: string | undefined) {
  const meta = p?.exams.find(e => e.id === examId)
  const [attempts, setAttempts] = useState<Attempt[] | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    setAttempts(undefined)
    if (meta && !meta.summaryOnly) void getAttempts(meta.id).then(a => { if (live) setAttempts(a ?? null) })
    else setAttempts(null)
    return () => { live = false }
  }, [meta?.id])
  const thresholds = getPrefs().thresholds
  return useMemo(() => {
    if (!meta || !attempts) return { meta, attempts, exam: null, after: null, before: null, analysis: null, impact: null }
    const exam: Exam = { items: meta.items, attempts }
    const after = rescore(exam, meta.adjustments)
    const before = analyze(exam, thresholds)
    const analysis = meta.adjustments.length ? analyze(after, thresholds) : before
    return { meta, attempts, exam, after, before, analysis, impact: impact(exam, after, p!.bands) }
  }, [meta, attempts, p?.bands, thresholds])
}

export const describeAdj = (a: Adjustment, label: string) => a.kind === 'drop' ? `Drop ${label}` : a.kind === 'full' ? `Full credit on ${label}` : `${label}: also accept ${a.accept?.join(' and ')}`

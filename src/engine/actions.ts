// Artifacts the instructor applies: grade import files, a class summary, and item bank snapshots.
import { toCsv } from './importer.ts'
import { analyze, percents, quantile, rescore, type Analysis, type Flag } from './stats.ts'
import type { Adjustment, Exam } from './types.ts'

const round2 = (x: number) => Math.round(x * 100) / 100

/** Score each student on the grade item's scale (after regrades), e.g. out of 40 or out of 100. */
export function scaledScores(exam: Exam, adj: Adjustment[], outOf: number) {
  const re = rescore(exam, adj)
  return percents(re).map(p => round2((p / 100) * outOf))
}

/**
 * Brightspace Grades import: OrgDefinedId or Username identifies the user, a "<item> Points Grade"
 * column carries the score, and the last column must be "End-of-Line Indicator" with a # on every row.
 */
export function brightspaceCsv(exam: Exam, adj: Adjustment[], gradeItem: string, outOf: number) {
  const s = scaledScores(exam, adj, outOf)
  const rows: (string | number)[][] = [['OrgDefinedId', 'Username', `${gradeItem} Points Grade`, 'End-of-Line Indicator']]
  exam.attempts.forEach((a, i) => rows.push([a.lmsId ? `#${a.lmsId}` : '', a.username ? `#${a.username}` : '', s[i], '#']))
  return toCsv(rows)
}

/** Canvas gradebook import: the five identity columns, then "Assignment Name (assignment id)". */
export function canvasCsv(exam: Exam, adj: Adjustment[], assignment: string, outOf: number) {
  const s = scaledScores(exam, adj, outOf)
  const rows: (string | number)[][] = [['Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Section', assignment]]
  rows.push(['Points Possible', '', '', '', '', outOf])
  exam.attempts.forEach((a, i) => rows.push([a.name ?? a.id, a.lmsId ?? '', '', a.username ?? '', '', s[i]]))
  return toCsv(rows)
}

export const missingIds = (exam: Exam) => exam.attempts.filter(a => !a.lmsId && !a.username).length

/** Student-facing summary: centre and spread only. No ranks, no individual scores. */
export function classSummary(a: Analysis, title: string, adjustedNote?: string) {
  const t = a.test
  const pct = (x: number) => `${Math.round((x / (t.maxTotal || 1)) * 1000) / 10}%`
  const lines = [
    `${title}: class results`,
    '',
    `${t.n} students wrote the exam. Scores are out of ${round2(t.maxTotal)}.`,
    `Median: ${round2(t.median)} (${pct(t.median)})`,
    `Middle half of the class scored between ${round2(t.q1)} and ${round2(t.q3)} (${pct(t.q1)} to ${pct(t.q3)}).`,
    `Average: ${round2(t.mean)} (${pct(t.mean)})`,
    '',
    'Score distribution:',
    ...t.histogram.map((c, i) => `${String(i * 10).padStart(3)}${i === 9 ? '-100' : `-${i * 10 + 9}`.padEnd(4)}  ${'#'.repeat(Math.round((c / (t.n || 1)) * 60))}`),
  ]
  if (adjustedNote) lines.push('', adjustedNote)
  lines.push('', 'This summary shows the median and quartiles only. Individual scores and ranks are never shared.')
  return lines.join('\n')
}

// ---------- Item bank ----------

export interface SnapshotItem { bankKey: string; label: string; stem?: string; p: number; d: number | null; r: number | null; flags: Flag[]; maxPoints: number }
export interface ExamSnapshot {
  id: string
  title: string
  term: string
  date: string
  createdAt: number
  n: number
  k: number
  alpha: number | null
  kr20: number | null
  sem: number | null
  meanPct: number
  medianPct: number
  adjustments: Adjustment[]
  items: SnapshotItem[]
  /** True for summary-only imports (Canvas Item Analysis) with no student rows. */
  summaryOnly?: boolean
}

export function snapshotOf(exam: Exam, adj: Adjustment[], meta: Pick<ExamSnapshot, 'id' | 'title' | 'term' | 'date'>, a: Analysis = analyze(rescore(exam, adj))): ExamSnapshot {
  // Items keep their pre-regrade statistics so a dropped item still shows in the bank.
  const raw = analyze(exam)
  return {
    ...meta, createdAt: Date.now(), n: a.test.n, k: a.test.k, alpha: a.test.alpha, kr20: a.test.kr20, sem: a.test.sem, meanPct: a.test.meanPct,
    medianPct: a.test.maxTotal ? (a.test.median / a.test.maxTotal) * 100 : 0, adjustments: adj,
    items: exam.items.map((it, j) => ({ bankKey: it.bankKey, label: it.label, stem: it.stem?.split('\n')[0], p: raw.items[j].p, d: raw.items[j].d, r: raw.items[j].rCorrected, flags: raw.items[j].flags, maxPoints: it.maxPoints })),
  }
}

export interface TrendRow { bankKey: string; label: string; stem?: string; points: { snap: string; term: string; p: number; d: number | null; r: number | null; flags: Flag[] }[] }

/** One row per bank item, with a point per sitting in date order. */
export function trend(snaps: ExamSnapshot[]): TrendRow[] {
  const ordered = [...snaps].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
  const rows = new Map<string, TrendRow>()
  for (const s of ordered) for (const it of s.items) {
    const row = rows.get(it.bankKey) ?? { bankKey: it.bankKey, label: it.label, stem: it.stem, points: [] }
    row.label = it.label
    row.stem ??= it.stem
    row.points.push({ snap: s.id, term: s.term, p: it.p, d: it.d, r: it.r, flags: it.flags })
    rows.set(it.bankKey, row)
  }
  return [...rows.values()]
}

export interface CompareRow { bankKey: string; label: string; stem?: string; a?: SnapshotItem; b?: SnapshotItem; dp: number | null; dr: number | null; note: string }

export function compare(a: ExamSnapshot, b: ExamSnapshot): { rows: CompareRow[]; added: number; removed: number; alpha: [number | null, number | null] } {
  const keys = [...new Set([...a.items.map(i => i.bankKey), ...b.items.map(i => i.bankKey)])]
  const rows = keys.map(k => {
    const x = a.items.find(i => i.bankKey === k), y = b.items.find(i => i.bankKey === k)
    const dp = x && y ? y.p - x.p : null
    const dr = x && y && x.r !== null && y.r !== null ? y.r - x.r : null
    const note = !x ? 'New this sitting' : !y ? 'Not used this sitting'
      : dr !== null && (dr < -0.25 || (x.r! > 0.15 && y.r! < 0)) ? 'Discrimination collapsed: check for a key or wording change'
      : dp !== null && Math.abs(dp) >= 0.15 ? (dp > 0 ? 'Much easier than before' : 'Much harder than before')
      : 'Stable'
    return { bankKey: k, label: (y ?? x)!.label, stem: (y ?? x)!.stem, a: x, b: y, dp, dr, note }
  })
  return { rows, added: rows.filter(r => !r.a).length, removed: rows.filter(r => !r.b).length, alpha: [a.alpha, b.alpha] }
}

export const median = (xs: number[]) => quantile([...xs].sort((a, b) => a - b), 0.5)

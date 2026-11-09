import { DEFAULT_THRESHOLDS, type Adjustment, type Band, type Exam, type Item, type Thresholds } from './types.ts'

// ---------- Basic statistics (population moments, as KR-20 and alpha are defined) ----------

export const sum = (a: number[]) => a.reduce((s, x) => s + x, 0)
export const mean = (a: number[]) => a.length ? sum(a) / a.length : 0
export const variance = (a: number[]) => { const m = mean(a); return a.length ? sum(a.map(x => (x - m) ** 2)) / a.length : 0 }
export const sd = (a: number[]) => Math.sqrt(variance(a))

export function pearson(x: number[], y: number[]): number | null {
  const mx = mean(x), my = mean(y)
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < x.length; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy)
}

/** Quantile with linear interpolation between order statistics (type 7, the spreadsheet default). */
export function quantile(sorted: number[], q: number) {
  if (!sorted.length) return 0
  const h = (sorted.length - 1) * q, lo = Math.floor(h)
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (h - lo)
}

// ---------- Regrading ----------

/** Applies regrade decisions. Dropped items leave the exam; the rest are rescored. */
export function rescore(exam: Exam, adj: Adjustment[]): Exam {
  if (!adj.length) return exam
  const by = new Map(adj.map(a => [a.itemId, a]))
  const keep = exam.items.map((it, i) => ({ it, i })).filter(({ it }) => by.get(it.id)?.kind !== 'drop')
  return {
    items: keep.map(({ it }) => { const a = by.get(it.id); return a?.kind === 'accept' ? { ...it, key: [...new Set([...(it.key ?? []), ...(a.accept ?? [])])] } : it }),
    attempts: exam.attempts.map(s => ({
      ...s,
      scores: keep.map(({ it, i }) => {
        const a = by.get(it.id)
        if (a?.kind === 'full') return it.maxPoints
        if (a?.kind === 'accept' && s.choices?.[i] && a.accept?.includes(s.choices[i]!)) return it.maxPoints
        return s.scores[i]
      }),
      choices: s.choices ? keep.map(({ i }) => s.choices![i]) : undefined,
    })),
  }
}

export const maxTotal = (exam: Exam) => sum(exam.items.map(i => i.maxPoints))
export const totals = (exam: Exam) => exam.attempts.map(s => sum(s.scores.map(x => x ?? 0)))
export const percents = (exam: Exam) => { const m = maxTotal(exam) || 1; return totals(exam).map(t => (t / m) * 100) }

export function band(pct: number, bands: Band[]) {
  const sorted = [...bands].sort((a, b) => b.min - a.min)
  // Small epsilon so 89.9999 from float noise does not fall a band.
  return (sorted.find(b => pct + 1e-9 >= b.min) ?? sorted[sorted.length - 1]).label
}

// ---------- Item and test analysis ----------

export interface OptionStat {
  option: string
  isKey: boolean
  /** Share of all students choosing it, and of the upper / lower 27% groups. */
  all: number
  upper: number
  lower: number
  /** Point-biserial of "chose this option" against the rest-of-test score. */
  r: number | null
  /** Share chosen in each score quintile, lowest first. */
  byGroup: number[]
}

export type Flag = 'miskey' | 'ambiguous' | 'negative' | 'weak' | 'easy' | 'hard' | 'nfd' | 'highDistractor'
export const FLAG_TEXT: Record<Flag, string> = {
  miskey: 'Likely miskey', ambiguous: 'Ambiguous', negative: 'Negative discrimination', weak: 'Weak discrimination',
  easy: 'Too easy', hard: 'Too hard', nfd: 'Non-functioning distractor', highDistractor: 'Distractor attracts high scorers',
}
export const FLAG_SEVERITY: Record<Flag, 0 | 1 | 2> = { miskey: 2, negative: 2, ambiguous: 1, highDistractor: 1, hard: 1, weak: 1, easy: 0, nfd: 0 }

export interface ItemStat {
  id: string
  label: string
  index: number
  maxPoints: number
  dichotomous: boolean
  n: number
  /** Difficulty: mean score as a share of max points (classic p-value for 0/1 items). */
  p: number
  /** Upper-minus-lower 27% discrimination index. */
  d: number
  pbis: number | null
  /** Correlation with the total excluding this item. */
  rCorrected: number | null
  alphaIfDeleted: number | null
  options: OptionStat[]
  flags: Flag[]
  /** Distractor suspected of being the real answer (miskey) or competing with it (ambiguous). */
  suspect?: string
}

export interface TestStat {
  n: number
  k: number
  maxTotal: number
  mean: number
  sd: number
  median: number
  q1: number
  q3: number
  min: number
  max: number
  meanPct: number
  kr20: number | null
  kr21: number | null
  alpha: number | null
  sem: number | null
  /** Histogram of percent scores in 10-point bins, 0-9 ... 90-100. */
  histogram: number[]
}

export interface Analysis { test: TestStat; items: ItemStat[] }

export function alphaOf(cols: number[][], tot: number[]): number | null {
  const k = cols.length
  const vt = variance(tot)
  if (k < 2 || vt === 0) return null
  return (k / (k - 1)) * (1 - sum(cols.map(variance)) / vt)
}

export function analyze(exam: Exam, th: Thresholds = DEFAULT_THRESHOLDS): Analysis {
  const N = exam.attempts.length
  const k = exam.items.length
  const cols = exam.items.map((_, j) => exam.attempts.map(s => s.scores[j] ?? 0))
  const tot = totals(exam)
  const mt = maxTotal(exam)
  const sortedTot = [...tot].sort((a, b) => a - b)
  const dich = exam.items.every((it, j) => it.maxPoints === 1 && cols[j].every(x => x === 0 || x === 1))
  const alpha = alphaOf(cols, tot)
  const vt = variance(tot), m = mean(tot)
  const kr21 = dich && k > 1 && vt > 0 ? (k / (k - 1)) * (1 - (m * (k - m)) / (k * vt)) : null

  // Upper and lower 27% by total score; ties broken by order, which is the usual convention.
  const order = tot.map((t, i) => ({ t, i })).sort((a, b) => b.t - a.t || a.i - b.i).map(x => x.i)
  const g = Math.max(1, Math.round(N * 0.27))
  const upper = order.slice(0, g), lower = order.slice(-g)
  // Quintiles for distractor curves, lowest scorers first.
  const asc = [...order].reverse()
  const groups = [0, 1, 2, 3, 4].map(q => asc.slice(Math.floor((q * N) / 5), Math.floor(((q + 1) * N) / 5)))

  const items: ItemStat[] = exam.items.map((it, j) => {
    const col = cols[j]
    const mp = it.maxPoints || 1
    const p = N ? mean(col) / mp : 0
    const pg = (idx: number[]) => idx.length ? mean(idx.map(i => col[i])) / mp : 0
    const d = pg(upper) - pg(lower)
    const rest = tot.map((t, i) => t - col[i])
    const pbis = pearson(col, tot)
    const rCorrected = pearson(col, rest)
    const others = cols.filter((_, x) => x !== j)
    const alphaIfDeleted = alphaOf(others, rest)

    let options: OptionStat[] = []
    if (it.options?.length && exam.attempts.some(s => s.choices)) {
      const ch = exam.attempts.map(s => s.choices?.[j] ?? null)
      const share = (idx: number[], o: string) => idx.length ? idx.filter(i => ch[i] === o).length / idx.length : 0
      options = it.options.map(o => ({
        option: o,
        isKey: !!it.key?.includes(o),
        all: share(order, o),
        upper: share(upper, o),
        lower: share(lower, o),
        r: pearson(ch.map(c => (c === o ? 1 : 0)), rest),
        byGroup: groups.map(gr => share(gr, o)),
      }))
    }

    const flags: Flag[] = []
    let suspect: string | undefined
    const keyOpts = options.filter(o => o.isKey)
    const keyUpper = sum(keyOpts.map(o => o.upper))
    const keyR = keyOpts.length === 1 ? keyOpts[0].r ?? 0 : rCorrected ?? 0
    const distractors = options.filter(o => !o.isKey)
    const top = [...distractors].sort((a, b) => (b.r ?? -1) - (a.r ?? -1))[0]
    if (top && (top.r ?? 0) > 0.1 && (top.r ?? 0) > keyR && top.upper > keyUpper) { flags.push('miskey'); suspect = top.option }
    else if (top && (top.r ?? 0) > 0.05 && top.upper >= 0.2 && top.upper >= keyUpper * 0.5) { flags.push('ambiguous'); suspect = top.option }
    if (!flags.includes('miskey') && distractors.some(o => o.upper > o.lower + 0.05 && (o.r ?? 0) > 0)) flags.push('highDistractor')
    if ((rCorrected ?? 0) < 0 || d < 0) flags.push('negative')
    else if (d < th.weakD) flags.push('weak')
    if (p > th.easy) flags.push('easy')
    if (p < th.hard) flags.push('hard')
    if (distractors.some(o => o.all < th.nfd)) flags.push('nfd')

    return { id: it.id, label: it.label, index: j, maxPoints: it.maxPoints, dichotomous: it.maxPoints === 1 && col.every(x => x === 0 || x === 1), n: N, p, d, pbis, rCorrected, alphaIfDeleted, options, flags, suspect }
  })

  const pct = tot.map(t => (mt ? (t / mt) * 100 : 0))
  const histogram = new Array(10).fill(0)
  for (const x of pct) histogram[Math.min(9, Math.floor(x / 10))]++

  return {
    test: {
      n: N, k, maxTotal: mt, mean: m, sd: sd(tot), median: quantile(sortedTot, 0.5), q1: quantile(sortedTot, 0.25), q3: quantile(sortedTot, 0.75),
      min: sortedTot[0] ?? 0, max: sortedTot[N - 1] ?? 0, meanPct: mt ? (m / mt) * 100 : 0,
      kr20: dich ? alpha : null, kr21, alpha, sem: alpha === null ? null : sd(tot) * Math.sqrt(Math.max(0, 1 - alpha)), histogram,
    },
    items,
  }
}

export const severity = (s: ItemStat) => Math.max(-1, ...s.flags.map(f => FLAG_SEVERITY[f]))

// ---------- Regrade impact ----------

export interface StudentChange { id: string; before: number; after: number; bandBefore: string; bandAfter: string }
export interface Impact {
  students: StudentChange[]
  /** Count per band before and after. */
  bands: { label: string; before: number; after: number }[]
  changedBand: number
  raised: number
  meanBefore: number
  meanAfter: number
}

export function impact(before: Exam, after: Exam, bands: Band[]): Impact {
  const pb = percents(before), pa = percents(after)
  const students = before.attempts.map((s, i) => ({ id: s.id, before: pb[i], after: pa[i], bandBefore: band(pb[i], bands), bandAfter: band(pa[i], bands) }))
  const labels = [...bands].sort((a, b) => b.min - a.min).map(b => b.label)
  return {
    students,
    bands: labels.map(l => ({ label: l, before: students.filter(s => s.bandBefore === l).length, after: students.filter(s => s.bandAfter === l).length })),
    changedBand: students.filter(s => s.bandBefore !== s.bandAfter).length,
    raised: students.filter(s => s.after > s.before + 1e-9).length,
    meanBefore: mean(pb),
    meanAfter: mean(pa),
  }
}

// ---------- Fix suggestions ----------

export interface Suggestion { title: string; evidence: string; action?: Adjustment }

const pc = (x: number) => `${Math.round(x * 100)}%`
const r2 = (x: number | null) => (x === null ? 'n/a' : x.toFixed(2))

export function suggest(s: ItemStat, item: Item): Suggestion[] {
  const out: Suggestion[] = []
  const key = item.key?.join(', ') ?? '?'
  const sus = s.options.find(o => o.option === s.suspect)
  const ko = s.options.find(o => o.isKey)
  if (s.flags.includes('miskey') && sus) {
    out.push({ title: `Check the key: ${sus.option} may be the right answer`, evidence: `${pc(sus.upper)} of the top 27% chose ${sus.option} versus ${pc(ko?.upper ?? 0)} for the keyed ${key}. Choosing ${sus.option} correlates ${r2(sus.r)} with the rest of the test; choosing ${key} correlates ${r2(ko?.r ?? null)}.`, action: { itemId: s.id, kind: 'accept', accept: [sus.option] } })
  } else if (s.flags.includes('ambiguous') && sus) {
    out.push({ title: `Accept ${key} and ${sus.option}, then reword`, evidence: `Strong students split: ${pc(ko?.upper ?? 0)} of the top group chose ${key} and ${pc(sus.upper)} chose ${sus.option}. Read ${sus.option} for a defensible reading of the stem.`, action: { itemId: s.id, kind: 'accept', accept: [sus.option] } })
  }
  if (s.flags.includes('negative')) {
    out.push({ title: 'Drop or give full credit this sitting', evidence: `Students who did worse overall did better here (upper-lower D = ${s.d.toFixed(2)}, corrected r = ${r2(s.rCorrected)}). Alpha would move to ${r2(s.alphaIfDeleted)} without it.`, action: { itemId: s.id, kind: 'drop' } })
  } else if (s.flags.includes('weak')) {
    out.push({ title: 'Revise before reuse', evidence: `It barely separates strong from weak students (D = ${s.d.toFixed(2)}). Tighten the stem or replace the weakest distractor.` })
  }
  if (s.flags.includes('hard') && !s.flags.includes('miskey')) out.push({ title: 'Check coverage and wording', evidence: `Only ${pc(s.p)} answered correctly. If the topic was taught, look for a trick in the wording; otherwise consider full credit.`, action: { itemId: s.id, kind: 'full' } })
  if (s.flags.includes('easy')) out.push({ title: 'Fine as a confidence item, weak as a measure', evidence: `${pc(s.p)} answered correctly, so it adds little to the spread of scores. Keep it if it checks a must-know fact.` })
  const nfd = s.options.filter(o => !o.isKey && o.all < 0.05)
  if (nfd.length) out.push({ title: `Replace distractor${nfd.length > 1 ? 's' : ''} ${nfd.map(o => o.option).join(', ')}`, evidence: `${nfd.map(o => `${o.option}: ${pc(o.all)}`).join(', ')} of students chose ${nfd.length > 1 ? 'them' : 'it'}. A distractor nobody picks makes the item easier to guess. Write one from a common misconception.` })
  if (s.flags.includes('highDistractor') && !s.flags.includes('ambiguous')) {
    const hd = s.options.filter(o => !o.isKey && o.upper > o.lower + 0.05 && (o.r ?? 0) > 0).map(o => o.option)
    out.push({ title: `Reread distractor ${hd.join(', ')}`, evidence: `More top-group than bottom-group students chose ${hd.join(', ')}. It may be partly right.` })
  }
  return out
}

// Parsers for LMS quiz exports. Everything runs in the browser; names become pseudonyms on the way in.
import type { Attempt, Exam, Item } from './types.ts'

// ---------- CSV ----------

export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, '')
  const first = text.slice(0, text.indexOf('\n') >>> 0 || text.length)
  const delim = [',', '\t', ';'].map(d => ({ d, n: first.split(d).length })).sort((a, b) => b.n - a.n)[0].d
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false }
      else cell += c
    } else if (c === '"' && cell === '') q = true
    else if (c === delim) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows.filter(r => r.some(c => c.trim() !== ''))
}

export const csvCell = (v: string | number) => { const s = String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
export const toCsv = (rows: (string | number)[][]) => rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'

// ---------- Pseudonyms ----------

/** cyrb53: a fast 53-bit string hash. Not cryptographic; it only keeps names off screens and out of sync. */
function cyrb53(str: string, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677) }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}
export const pseudonym = (id: string, salt: string) => 'S-' + cyrb53(salt + '|' + id.trim().toLowerCase()).toString(36).toUpperCase().padStart(6, '0').slice(-6)
export const stemKey = (stem: string) => 'k' + cyrb53(stem.toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()).toString(36)

// ---------- Formats ----------

export type Format = 'd2l-attempts' | 'd2l-grades' | 'canvas-student' | 'canvas-item' | 'moodle' | 'generic'
export const FORMAT_LABEL: Record<Format, string> = {
  'd2l-attempts': 'Brightspace quiz attempt details',
  'd2l-grades': 'Brightspace Grades export',
  'canvas-student': 'Canvas Student Analysis',
  'canvas-item': 'Canvas Item Analysis (summary only)',
  moodle: 'Moodle quiz responses / grades',
  generic: 'Generic student × item CSV',
}

export interface Issue { line: number; severity: 'error' | 'warning' | 'info'; message: string }
export interface ItemSummary { label: string; stem?: string; p: number; r: number | null; n: number; d?: number | null }
export interface Parsed {
  format: Format
  exam: Exam
  issues: Issue[]
  /** Header names and what each became, for the mapping step. */
  columns: { name: string; role: 'id' | 'name' | 'item' | 'ignored' | 'meta' }[]
  /** Canvas Item Analysis only has per-question numbers; there are no students. */
  summary?: ItemSummary[]
  multipleAttempts?: boolean
}
export interface ParseOptions { salt: string; format?: Format; idColumn?: string; ignore?: string[]; key?: string }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]+/g, '')
const findCol = (h: string[], ...names: string[]) => { const n = names.map(norm); return h.findIndex(x => n.includes(norm(x))) }
const num = (s: string | undefined) => { if (s === undefined) return NaN; const t = s.trim().replace(/%$/, ''); return t === '' || t === '-' ? NaN : Number(t.replace(',', '.')) }

export function detect(h: string[]): Format {
  const n = h.map(norm)
  if (n.includes('questionid') && n.some(x => x.startsWith('pointbiserial') || x === 'difficultyindex')) return 'canvas-item'
  if ((n.includes('q#') || n.includes('qtext') || n.includes('qtitle')) && (n.includes('answermatch') || n.includes('outof') || n.includes('score'))) return 'd2l-attempts'
  if (h.some(x => /Points Grade/i.test(x)) || n.includes('endoflineindicator')) return 'd2l-grades'
  // sis_id only appears for users allowed to see SIS data, and anonymous surveys drop name and id.
  if (h.some(x => CANVAS_Q.test(x)) && n.includes('section') && n.includes('ncorrect')) return 'canvas-student'
  if ((n.includes('surname') || n.includes('firstname')) && h.some(x => /^(Response|Q\.)\s*\d+/i.test(x))) return 'moodle'
  return 'generic'
}

const CANVAS_Q = /^\d+:(\s|$)/
const letters = (i: number) => String.fromCharCode(65 + i)

export function parse(text: string, opts: ParseOptions): Parsed {
  const rows = parseCsv(text)
  if (rows.length < 2) return { format: 'generic', exam: { items: [], attempts: [] }, issues: [{ line: 1, severity: 'error', message: 'The file has no data rows.' }], columns: [] }
  const h = rows[0].map(x => x.trim())
  const format = opts.format ?? detect(h)
  const out = format === 'd2l-attempts' ? parseD2lAttempts(rows, opts)
    : format === 'canvas-item' ? parseCanvasItem(rows)
    : format === 'canvas-student' ? parseCanvasStudent(rows, opts)
    : format === 'moodle' ? parseMoodle(rows, opts)
    : format === 'd2l-grades' ? parseWide(rows, opts, 'd2l-grades')
    : parseWide(rows, opts, 'generic')
  const ids = new Map<string, number>()
  out.exam.attempts.forEach((a, i) => {
    if (ids.has(a.id)) out.issues.push({ line: i + 2, severity: 'warning', message: `Student ${a.id} appears more than once; later rows are kept as separate attempts.` })
    ids.set(a.id, i)
  })
  if (!out.summary && out.exam.attempts.length < 20 && out.exam.attempts.length > 0) out.issues.push({ line: 0, severity: 'info', message: `Only ${out.exam.attempts.length} students. Discrimination and reliability are unstable below about 30; read them as hints.` })
  if (!out.summary && !out.exam.items.length) out.issues.push({ line: 1, severity: 'error', message: 'No question columns were found. Check the format and mapping.' })
  return { ...out, format }
}

/** Assigns letters to answer texts in the order first seen, and infers the key from full-credit answers. */
function lettered(answers: (string | null)[][], scores: (number | null)[][], maxes: number[]) {
  return answers[0]?.map((_, j) => {
    const seen: string[] = []
    for (const r of answers) { const a = r[j]; if (a && !seen.includes(a)) seen.push(a) }
    if (seen.length < 2 || seen.length > 10) return null
    const sorted = [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    const letterOf = new Map(sorted.map((a, i) => [a, letters(i)]))
    const full = new Map<string, number>()
    answers.forEach((r, i) => { const a = r[j]; if (a && scores[i][j] !== null && scores[i][j]! >= maxes[j] - 1e-9) full.set(a, (full.get(a) ?? 0) + 1) })
    const key = [...full.entries()].filter(([, c]) => c > 0).map(([a]) => letterOf.get(a)!).sort()
    return { options: sorted.map(a => letterOf.get(a)!), key, letterOf, text: sorted }
  }) ?? []
}

function identity(h: string[], r: string[], opts: ParseOptions, idIdx: number, userIdx: number, nameIdx: number[]) {
  const lmsId = (r[idIdx] ?? '').trim()
  const username = userIdx >= 0 ? (r[userIdx] ?? '').trim().replace(/^#/, '') : undefined
  const name = nameIdx.map(i => (r[i] ?? '').trim()).filter(Boolean).join(' ') || undefined
  const raw = lmsId || username || name || ''
  return { id: raw ? pseudonym(raw, opts.salt) : '', lmsId: lmsId.replace(/^#/, '') || undefined, username, name }
}

function parseWide(rows: string[][], opts: ParseOptions, format: 'd2l-grades' | 'generic'): Omit<Parsed, 'format'> {
  const h = rows[0].map(x => x.trim())
  const issues: Issue[] = []
  let idIdx = opts.idColumn ? h.indexOf(opts.idColumn) : findCol(h, 'OrgDefinedId', 'Org Defined ID', 'Student ID', 'StudentID', 'ID', 'SIS ID', 'sis_id', 'Student', 'Username', 'Email')
  if (idIdx < 0) idIdx = 0
  const userIdx = findCol(h, 'Username', 'User Name')
  const nameIdx = [findCol(h, 'First Name', 'FirstName', 'Given Name'), findCol(h, 'Last Name', 'LastName', 'Surname', 'Family Name'), findCol(h, 'Name', 'Student Name', 'Full Name')].filter(i => i >= 0)
  const metaIdx = new Set([idIdx, userIdx, ...nameIdx, ...h.map((x, i) => (/^(email|section|end-of-line indicator|total|final|calculated final grade|adjusted final grade|grade|percent|%|attempt|start|end|time|date)/i.test(x) || /Subtotal|Final (Calculated|Adjusted)|Text Grade|Scheme Symbol/i.test(x) ? i : -1))].filter(i => i >= 0))
  const ignore = new Set(opts.ignore ?? [])
  let body = rows.slice(1)
  // An answer key row: first cell KEY / ANSWER KEY / ANSWERS.
  const keyRowIdx = body.findIndex(r => /^(answer\s*)?keys?$|^answers?$/i.test((r[idIdx] ?? '').trim()))
  const keyRow = keyRowIdx >= 0 ? body[keyRowIdx] : null
  if (keyRowIdx >= 0) body = body.filter((_, i) => i !== keyRowIdx)
  const itemIdx = h.map((_, i) => i).filter(i => !metaIdx.has(i) && !ignore.has(h[i]) && h[i] !== '' && body.some(r => (r[i] ?? '').trim() !== ''))
  const extKey = opts.key?.split(/[\s,;]+/).filter(Boolean)
  const isLetters = itemIdx.length > 0 && itemIdx.every(i => body.every(r => { const v = (r[i] ?? '').trim(); return v === '' || /^[A-Ja-j](\s*[,;/]\s*[A-Ja-j])*$/.test(v) }))
  const items: Item[] = itemIdx.map((i, j) => {
    const raw = h[i]
    const label = raw.replace(/\s*Points Grade.*$/i, '').replace(/\s*<.*>$/, '').trim() || `Q${j + 1}`
    const mp = raw.match(/MaxPoints:\s*([\d.]+)/i)
    const observed = Math.max(1, ...body.map(r => num(r[i])).filter(x => !isNaN(x)))
    const key = isLetters ? (keyRow?.[i] ?? extKey?.[j] ?? '').toUpperCase().split(/[\s,;/]+/).filter(Boolean) : undefined
    return { id: `q${j + 1}`, label, maxPoints: isLetters ? 1 : mp ? Number(mp[1]) : observed, bankKey: stemKey(label), ...(isLetters ? { key, options: [] as string[] } : {}) }
  })
  if (isLetters && items.some(it => !it.key?.length)) issues.push({ line: keyRowIdx >= 0 ? keyRowIdx + 2 : 0, severity: 'error', message: 'Answers are letters but no answer key was found. Add a row whose first cell is KEY, or paste the key below.' })
  if (format === 'generic' && !isLetters && itemIdx.length) issues.push({ line: 1, severity: 'info', message: `Read ${itemIdx.length} columns as item scores. Max points per item = the highest score seen unless the header says MaxPoints.` })
  const attempts: Attempt[] = []
  body.forEach((r, bi) => {
    const line = bi + 2 + (keyRowIdx >= 0 && bi >= keyRowIdx ? 1 : 0)
    if (r.length < h.length - 1 && r.length !== h.length) issues.push({ line, severity: 'warning', message: `Row has ${r.length} cells; the header has ${h.length}.` })
    const who = identity(h, r, opts, idIdx, userIdx, nameIdx)
    if (!who.id) { issues.push({ line, severity: 'warning', message: 'No student identifier; row skipped.' }); return }
    const choices: (string | null)[] = []
    const scores = itemIdx.map((i, j) => {
      const v = (r[i] ?? '').trim()
      if (isLetters) {
        const c = v ? v.toUpperCase() : null
        choices.push(c)
        if (c && !items[j].options!.includes(c)) items[j].options!.push(c)
        return c && items[j].key?.includes(c) ? 1 : 0
      }
      const x = num(v)
      if (v === '') return 0
      if (isNaN(x)) { issues.push({ line, severity: 'warning', message: `${items[j].label}: "${v}" is not a number; counted as 0.` }); return 0 }
      if (x > items[j].maxPoints + 1e-9) issues.push({ line, severity: 'warning', message: `${items[j].label}: ${x} is above the ${items[j].maxPoints} maximum.` })
      if (x < 0) issues.push({ line, severity: 'warning', message: `${items[j].label}: negative score ${x}.` })
      return x
    })
    const blanks = scores.filter(x => x === null).length
    if (!isLetters && blanks) issues.push({ line, severity: 'info', message: `${blanks} blank score${blanks > 1 ? 's' : ''} counted as 0. In Brightspace, blank and 0 differ: check "Treat ungraded items as 0" in Grades settings.` })
    attempts.push({ ...who, scores, ...(isLetters ? { choices } : {}) })
  })
  for (const it of items) if (it.options) it.options.sort()
  return { exam: { items, attempts }, issues, columns: h.map((name, i) => ({ name, role: i === idIdx ? 'id' : nameIdx.includes(i) || i === userIdx ? 'name' : itemIdx.includes(i) ? 'item' : ignore.has(name) ? 'ignored' : 'meta' })) }
}

function parseD2lAttempts(rows: string[][], opts: ParseOptions): Omit<Parsed, 'format'> {
  const h = rows[0].map(x => x.trim())
  const issues: Issue[] = []
  const c = {
    org: findCol(h, 'Org Defined ID', 'OrgDefinedId'), user: findCol(h, 'Username', 'User Name'), first: findCol(h, 'FirstName', 'First Name'), last: findCol(h, 'LastName', 'Last Name'),
    attempt: findCol(h, 'Attempt #', 'Attempt'), qn: findCol(h, 'Q #', 'Q Num', 'Question #'), qtitle: findCol(h, 'Q Title'), qtext: findCol(h, 'Q Text', 'Question'),
    answer: findCol(h, 'Answer'), match: findCol(h, 'Answer Match'), score: findCol(h, 'Score'), out: findCol(h, 'Out Of'), bonus: findCol(h, 'Bonus?'),
  }
  if (c.score < 0) issues.push({ line: 1, severity: 'error', message: 'No "Score" column. Export with question scores included.' })
  const idIdx = c.org >= 0 ? c.org : c.user
  const qKeys: string[] = []
  const qInfo = new Map<string, { label: string; stem?: string; max: number }>()
  const studs = new Map<string, { who: ReturnType<typeof identity>; att: string; score: Map<string, number>; choice: Map<string, string> }>()
  let multi = false
  rows.slice(1).forEach((r, bi) => {
    const line = bi + 2
    const who = identity(h, r, opts, idIdx, c.user, [c.first, c.last].filter(i => i >= 0))
    if (!who.id) { issues.push({ line, severity: 'warning', message: 'No Org Defined ID or Username; row skipped.' }); return }
    const att = c.attempt >= 0 ? (r[c.attempt] ?? '1').trim() : '1'
    const qk = (c.qn >= 0 ? r[c.qn] : '') + '|' + (c.qtext >= 0 ? r[c.qtext] : c.qtitle >= 0 ? r[c.qtitle] : '')
    if (!qInfo.has(qk)) {
      qKeys.push(qk)
      const stem = (c.qtext >= 0 ? r[c.qtext] : c.qtitle >= 0 ? r[c.qtitle] : '')?.trim()
      qInfo.set(qk, { label: c.qn >= 0 && r[c.qn]?.trim() ? `Q${r[c.qn].trim()}` : `Q${qKeys.length}`, stem: stem || undefined, max: num(r[c.out]) || 1 })
    }
    let s = studs.get(who.id)
    if (s && s.att !== att) {
      multi = true
      // Item analysis uses each student's first attempt.
      if (Number(att) > Number(s.att)) return
      s = undefined
    }
    if (!s) { s = { who, att, score: new Map(), choice: new Map() }; studs.set(who.id, s) }
    const sc = num(r[c.score])
    if (!isNaN(sc)) s.score.set(qk, sc)
    const m = c.match >= 0 ? (r[c.match] ?? '').trim().toLowerCase() : ''
    if (c.answer >= 0 && (m === 'checked' || m === 'selected' || m === 'true')) {
      // Multi-select questions have several checked rows; the choice is the combination.
      const prev = s.choice.get(qk), a = (r[c.answer] ?? '').trim()
      s.choice.set(qk, prev ? `${prev}; ${a}` : a)
    }
  })
  if (multi) issues.push({ line: 0, severity: 'info', message: 'Some students have more than one attempt. Only each student\'s first attempt is analysed.' })
  const list = [...studs.values()]
  const maxes = qKeys.map(k => qInfo.get(k)!.max)
  const sc = list.map(s => qKeys.map(k => s.score.get(k) ?? null))
  const ans = list.map(s => qKeys.map(k => s.choice.get(k) ?? null))
  const lt = lettered(ans, sc, maxes)
  const items: Item[] = qKeys.map((k, j) => {
    const q = qInfo.get(k)!
    const L = lt[j]
    return { id: `q${j + 1}`, label: q.label, stem: q.stem, maxPoints: q.max, bankKey: q.stem ? stemKey(q.stem) : q.label, ...(L ? { options: L.options, key: L.key } : {}) }
  })
  const attempts: Attempt[] = list.map((s, i) => ({ ...s.who, scores: sc[i], ...(lt.some(Boolean) ? { choices: ans[i].map((a, j) => (a && lt[j] ? lt[j]!.letterOf.get(a) ?? null : null)) } : {}) }))
  const optText = lt.map(L => L?.text)
  return { exam: { items: items.map((it, j) => (optText[j] ? { ...it, stem: (it.stem ?? '') + optionsSuffix(optText[j]!) } : it)), attempts }, issues, columns: h.map((name, i) => ({ name, role: i === idIdx ? 'id' : [c.first, c.last, c.user].includes(i) ? 'name' : [c.qn, c.qtext, c.answer, c.match, c.score, c.out].includes(i) ? 'item' : 'meta' })), multipleAttempts: multi }
}
const optionsSuffix = (t: string[]) => '\n' + t.map((x, i) => `${letters(i)}. ${x}`).join('\n')

function parseCanvasStudent(rows: string[][], opts: ParseOptions): Omit<Parsed, 'format'> {
  const h = rows[0].map(x => x.trim())
  const issues: Issue[] = []
  const nameIdx = findCol(h, 'name'), idIdx = findCol(h, 'sis_id') >= 0 && rows.slice(1).some(r => r[findCol(h, 'sis_id')]?.trim()) ? findCol(h, 'sis_id') : findCol(h, 'id')
  const attemptIdx = findCol(h, 'attempt')
  const qs = h.map((x, i) => ({ x, i })).filter(({ x }) => CANVAS_Q.test(x))
  const body: string[][] = []
  const seen = new Map<string, number>()
  rows.slice(1).forEach((r, ri) => {
    // Anonymous quizzes have no name or id: every row is its own student.
    const id = idIdx >= 0 ? (r[idIdx] ?? '').trim() : `row${ri}`
    const prev = seen.get(id)
    // Canvas lists one row per attempt; keep the first.
    if (prev !== undefined) { if (attemptIdx >= 0 && Number(r[attemptIdx]) < Number(body[prev][attemptIdx])) body[prev] = r; return }
    seen.set(id, body.length); body.push(r)
  })
  const maxes = qs.map(({ i }) => num(h[i + 1]) || 1)
  const sc = body.map(r => qs.map(({ i }) => { const x = num(r[i + 1]); return isNaN(x) ? null : x }))
  const ans = body.map(r => qs.map(({ i }) => (r[i] ?? '').trim() || null))
  const lt = lettered(ans, sc, maxes)
  const items: Item[] = qs.map(({ x }, j) => {
    const stem = x.replace(/^\d+:\s*/, '')
    const L = lt[j]
    return { id: `q${j + 1}`, label: `Q${j + 1}`, stem: L ? stem + optionsSuffix(L.text) : stem, maxPoints: maxes[j], bankKey: stemKey(stem), ...(L ? { options: L.options, key: L.key } : {}) }
  })
  if (idIdx < 0) issues.push({ line: 1, severity: 'info', message: 'Anonymous export: no name or id columns, so students get row-based pseudonyms and no grade import can be built.' })
  // Canvas grade imports match on the Canvas user id, so keep that as the LMS id even when the pseudonym uses sis_id.
  const canvasId = findCol(h, 'id')
  const attempts = body.map((r, i) => ({ ...(idIdx >= 0 ? { ...identity(h, r, opts, idIdx, -1, [nameIdx]), ...(canvasId >= 0 && r[canvasId]?.trim() ? { lmsId: r[canvasId].trim() } : {}) } : { id: pseudonym(`anon-${i}`, opts.salt) }), scores: sc[i], choices: ans[i].map((a, j) => (a && lt[j] ? lt[j]!.letterOf.get(a) ?? null : null)) }))
  if (!qs.length) issues.push({ line: 1, severity: 'error', message: 'No question columns ("<id>: <question text>") found.' })
  return { exam: { items, attempts }, issues, columns: h.map((name, i) => ({ name, role: i === idIdx ? 'id' : i === nameIdx ? 'name' : qs.some(q => q.i === i || q.i + 1 === i) ? 'item' : 'meta' })) }
}

function parseMoodle(rows: string[][], opts: ParseOptions): Omit<Parsed, 'format'> {
  const h = rows[0].map(x => x.trim())
  const issues: Issue[] = []
  const first = findCol(h, 'First name'), last = findCol(h, 'Surname', 'Last name'), email = findCol(h, 'Email address', 'Email'), idn = findCol(h, 'ID number')
  const idIdx = idn >= 0 && rows.slice(1).some(r => r[idn]?.trim()) ? idn : email >= 0 ? email : first
  const resp = new Map<number, number>(), right = new Map<number, number>(), grade = new Map<number, { i: number; max: number }>()
  h.forEach((x, i) => {
    let m = x.match(/^Response\s*(\d+)/i); if (m) resp.set(+m[1], i)
    m = x.match(/^Right answer\s*(\d+)/i); if (m) right.set(+m[1], i)
    m = x.match(/^Q\.\s*(\d+)\s*\/\s*([\d.,]+)/i); if (m) grade.set(+m[1], { i, max: num(m[2]) || 1 })
  })
  const qn = [...new Set([...resp.keys(), ...grade.keys()])].sort((a, b) => a - b)
  // Moodle appends an "Overall average" row to the grades report.
  const state = findCol(h, 'State')
  let skipped = 0, repeats = 0
  const firstOf = new Set<string>()
  const body = rows.slice(1).filter(r => {
    if (/overall average/i.test(r.join(' '))) return false
    // Only submitted attempts count: In progress, Overdue and Never submitted rows are left out.
    if (state >= 0 && r[state]?.trim() && !/^finished$/i.test(r[state].trim())) { skipped++; return false }
    const who = [idIdx, first, last].map(i => (i >= 0 ? r[i] ?? '' : '')).join('|').trim().toLowerCase()
    if (firstOf.has(who)) { repeats++; return false }
    firstOf.add(who)
    return true
  })
  if (skipped) issues.push({ line: 0, severity: 'info', message: `${skipped} attempt${skipped > 1 ? 's' : ''} not finished (in progress, overdue or never submitted) left out.` })
  if (repeats) issues.push({ line: 0, severity: 'info', message: `${repeats} later attempt${repeats > 1 ? 's' : ''} left out; each student's first finished attempt is analysed.` })
  const sc = body.map(r => qn.map(q => { const g = grade.get(q); if (!g) return null; const x = num(r[g.i]); return isNaN(x) ? null : x }))
  const ans = body.map(r => qn.map(q => (resp.has(q) ? (r[resp.get(q)!] ?? '').trim() : '') || null).map(a => (a === '-' ? null : a)))
  // Without grade columns, score a response as right when it matches "Right answer".
  qn.forEach((q, j) => {
    if (grade.has(q)) return
    if (!right.has(q)) { issues.push({ line: 1, severity: 'warning', message: `Question ${q} has no grade or right-answer column; it is scored 0. Download with "Right answer" shown or use the Grades report.` }); return }
    body.forEach((r, i) => { sc[i][j] = ans[i][j] !== null && ans[i][j] === (r[right.get(q)!] ?? '').trim() ? 1 : 0 })
  })
  const maxes = qn.map(q => grade.get(q)?.max ?? 1)
  const ungraded = body.reduce((n, r) => n + [...grade.values()].filter(g => /requires grading|not yet graded/i.test(r[g.i] ?? '')).length, 0)
  if (ungraded) issues.push({ line: 0, severity: 'warning', message: `${ungraded} answer${ungraded > 1 ? 's' : ''} still "Requires grading". They are left out of those students' scores and maximums; grade them in Moodle and export again for final numbers.` })
  const lt = lettered(ans, sc, maxes)
  const items: Item[] = qn.map((q, j) => ({ id: `q${j + 1}`, label: `Q${q}`, stem: lt[j] ? `Question ${q}` + optionsSuffix(lt[j]!.text) : undefined, maxPoints: maxes[j], bankKey: `Q${q}`, ...(lt[j] ? { options: lt[j]!.options, key: lt[j]!.key } : {}) }))
  const attempts = body.map((r, i) => ({ ...identity(h, r, opts, idIdx, -1, [first, last].filter(x => x >= 0)), lmsId: (r[idIdx] ?? '').trim() || undefined, scores: sc[i], choices: ans[i].map((a, j) => (a && lt[j] ? lt[j]!.letterOf.get(a) ?? null : null)) }))
  return { exam: { items, attempts }, issues, columns: h.map((name, i) => ({ name, role: i === idIdx ? 'id' : i === first || i === last ? 'name' : [...resp.values(), ...right.values(), ...[...grade.values()].map(g => g.i)].includes(i) ? 'item' : 'meta' })) }
}

function parseCanvasItem(rows: string[][]): Omit<Parsed, 'format'> {
  const h = rows[0].map(x => x.trim())
  const t = findCol(h, 'Question Title'), p = findCol(h, 'Correct Student Ratio', 'Difficulty Index'), r = findCol(h, 'Point Biserial of Correct'), n = findCol(h, 'Answered Student Count')
  const issues: Issue[] = [{ line: 0, severity: 'info', message: 'Item Analysis has per-question numbers only. It feeds the item bank trend; regrades and distractor charts need the Student Analysis report.' }]
  // Canvas splits students into top, middle and bottom 27% groups, so D = top share correct - bottom share correct.
  const [top, bot, ctop, cbot] = ['Top Student Count', 'Bottom Student Count', 'Correct Top Student Count', 'Correct Bottom Student Count'].map(x => findCol(h, x))
  const dOf = (row: string[]) => { const [a, b, c, e] = [top, bot, ctop, cbot].map(i => (i >= 0 ? num(row[i]) : NaN)); return a > 0 && b > 0 && !isNaN(c) && !isNaN(e) ? c / a - e / b : null }
  const summary = rows.slice(1).map((row, i) => ({ label: `Q${i + 1}`, stem: t >= 0 ? row[t]?.trim() : undefined, p: num(row[p]), r: r >= 0 && !isNaN(num(row[r])) ? num(row[r]) : null, n: n >= 0 ? num(row[n]) || 0 : 0, d: dOf(row) }))
  summary.forEach((s, i) => { if (isNaN(s.p)) issues.push({ line: i + 2, severity: 'warning', message: `No difficulty value for ${s.label}.` }) })
  return { exam: { items: [], attempts: [] }, issues, columns: h.map(name => ({ name, role: 'meta' as const })), summary: summary.map(s => ({ ...s, p: isNaN(s.p) ? 0 : s.p })) }
}

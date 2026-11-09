import assert from 'node:assert/strict'
import { test } from 'node:test'
import { brightspaceCsv, canvasCsv, classSummary, compare, snapshotOf, trend } from './actions.ts'
import { detect, parse, parseCsv, pseudonym, toCsv } from './importer.ts'
import { SAMPLES } from './sample.ts'
import { alphaOf, analyze, band, impact, pearson, quantile, rescore, suggest, totals } from './stats.ts'
import { DEFAULT_BANDS, type Exam } from './types.ts'

const near = (a: number | null, b: number, eps = 1e-6) => assert.ok(a !== null && Math.abs(a - b) < eps, `${a} != ${b}`)

const tiny = (): Exam => ({
  items: ['A', 'B', 'C'].map((k, j) => ({ id: `q${j + 1}`, label: `Q${j + 1}`, maxPoints: 1, key: [k], options: ['A', 'B', 'C', 'D'], bankKey: `t${j}` })),
  attempts: [
    { id: 's1', scores: [1, 1, 1], choices: ['A', 'B', 'C'] },
    { id: 's2', scores: [1, 1, 0], choices: ['A', 'B', 'D'] },
    { id: 's3', scores: [1, 0, 0], choices: ['A', 'C', 'D'] },
    { id: 's4', scores: [0, 0, 0], choices: ['B', 'C', 'A'] },
  ],
})

test('difficulty is the mean proportion correct', () => {
  const a = analyze(tiny())
  assert.deepEqual(a.items.map(i => i.p), [0.75, 0.5, 0.25])
})

test('KR-20 equals alpha on 0/1 items and matches the hand calculation', () => {
  const t = analyze(tiny()).test
  near(t.alpha, 0.75)
  near(t.kr20, 0.75)
})

test('KR-21 uses only mean, variance and item count', () => {
  near(analyze(tiny()).test.kr21, 0.6)
})

test('SEM = SD * sqrt(1 - reliability)', () => {
  near(analyze(tiny()).test.sem, Math.sqrt(1.25) * 0.5)
})

test('upper-lower 27% index on a perfect Guttman pattern is 1', () => {
  assert.deepEqual(analyze(tiny()).items.map(i => i.d), [1, 1, 1])
})

test('Pearson correlation basics and a constant column', () => {
  near(pearson([1, 2, 3], [2, 4, 6]), 1)
  near(pearson([1, 2, 3], [3, 2, 1]), -1)
  assert.equal(pearson([1, 1, 1], [1, 2, 3]), null)
})

test('corrected item-total r is lower than the uncorrected point-biserial', () => {
  const ex = SAMPLES[0].exams()[0].exam
  const a = analyze(ex)
  for (const it of a.items.slice(0, 10)) assert.ok((it.rCorrected ?? 0) < (it.pbis ?? 0))
})

test('alpha-if-deleted rises when a reversed item is removed', () => {
  const ex = SAMPLES[1].exams()[0].exam
  const a = analyze(ex)
  const q9 = a.items[8]
  assert.ok(q9.alphaIfDeleted! > a.test.alpha!, `${q9.alphaIfDeleted} vs ${a.test.alpha}`)
  const cols = ex.items.map((_, j) => ex.attempts.map(s => s.scores[j] ?? 0))
  near(alphaOf(cols, totals(ex)), a.test.alpha!)
})

test('quantiles interpolate like a spreadsheet', () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5)
  assert.equal(quantile([1, 2, 3, 4], 0.25), 1.75)
  assert.equal(quantile([5], 0.75), 5)
})

test('partial-credit exam reports alpha but not KR-20 or KR-21', () => {
  const t = analyze(SAMPLES[1].exams()[0].exam).test
  assert.ok(t.alpha !== null && t.alpha > 0.4)
  assert.equal(t.kr20, null)
  assert.equal(t.kr21, null)
})

test('sample midterm: the miskeyed Q17 is flagged and the true answer is named', () => {
  const ex = SAMPLES[0].exams()[1].exam
  const q17 = analyze(ex).items[16]
  assert.ok(q17.flags.includes('miskey'), q17.flags.join(','))
  const trueKey = SAMPLES[0].exams()[0].exam.items[16].key![0]
  assert.equal(q17.suspect, trueKey)
})

test('sample midterm: Q9 has a non-functioning distractor and the previous term has no miskey', () => {
  const [fall, winter] = SAMPLES[0].exams()
  assert.ok(analyze(winter.exam).items[8].flags.includes('nfd'))
  assert.equal(analyze(fall.exam).items.filter(i => i.flags.includes('miskey')).length, 0)
})

test('distractor shares add to 1 and reach every score group', () => {
  const q = analyze(SAMPLES[0].exams()[1].exam).items[3]
  near(q.options.reduce((s, o) => s + o.all, 0), 1)
  assert.equal(q.options[0].byGroup.length, 5)
})

test('rescore: drop removes the item from score and maximum', () => {
  const re = rescore(tiny(), [{ itemId: 'q3', kind: 'drop' }])
  assert.equal(re.items.length, 2)
  assert.deepEqual(totals(re), [2, 2, 1, 0])
})

test('rescore: full credit gives everyone the item', () => {
  assert.deepEqual(totals(rescore(tiny(), [{ itemId: 'q3', kind: 'full' }])), [3, 3, 2, 1])
})

test('rescore: accepting another option credits only students who chose it', () => {
  const re = rescore(tiny(), [{ itemId: 'q3', kind: 'accept', accept: ['D'] }])
  assert.deepEqual(totals(re), [3, 3, 2, 0])
  assert.deepEqual(re.items[2].key, ['C', 'D'])
})

test('accepting the true answer on the miskeyed item clears the flag and raises reliability', () => {
  const ex = SAMPLES[0].exams()[1].exam
  const before = analyze(ex)
  const after = analyze(rescore(ex, [{ itemId: 'q17', kind: 'accept', accept: [before.items[16].suspect!] }]))
  assert.ok(!after.items[16].flags.includes('miskey'))
  assert.ok(after.test.alpha! > before.test.alpha!)
})

test('grade bands use the highest band whose minimum is met', () => {
  assert.equal(band(90, DEFAULT_BANDS), 'A')
  assert.equal(band(89.99, DEFAULT_BANDS), 'B')
  assert.equal(band(12, DEFAULT_BANDS), 'F')
})

test('impact counts band changes per student', () => {
  const ex = tiny()
  const im = impact(ex, rescore(ex, [{ itemId: 'q3', kind: 'full' }]), DEFAULT_BANDS)
  assert.equal(im.raised, 3)
  assert.equal(im.changedBand, 2)
  assert.equal(im.bands.reduce((s, b) => s + b.after, 0), 4)
})

test('suggestions carry an action and evidence for a miskey', () => {
  const ex = SAMPLES[0].exams()[1].exam
  const s = analyze(ex).items[16]
  const sug = suggest(s, ex.items[16])
  assert.equal(sug[0].action?.kind, 'accept')
  assert.match(sug[0].evidence, /top 27%/)
})

test('CSV parser handles quotes, embedded commas, CRLF and a BOM', () => {
  const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n')
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'say "hi"']])
  assert.deepEqual(parseCsv(toCsv([['a,b', 'c']])), [['a,b', 'c']])
})

test('pseudonyms are stable, salted and do not contain the name', () => {
  const a = pseudonym('Maya Chen', 'x'), b = pseudonym('maya chen ', 'x'), c = pseudonym('Maya Chen', 'y')
  assert.equal(a, b)
  assert.notEqual(a, c)
  assert.match(a, /^S-[0-9A-Z]{6}$/)
})

test('generic letters CSV with a KEY row is scored against the key', () => {
  const p = parse('Student,Q1,Q2\nKEY,A,C\nann,A,B\nbob,B,C\n', { salt: 's' })
  assert.equal(p.format, 'generic')
  assert.deepEqual(p.exam.attempts.map(a => a.scores), [[1, 0], [0, 1]])
  assert.deepEqual(p.exam.items[1].options, ['B', 'C'])
  assert.ok(!p.exam.attempts.some(a => a.id.includes('ann')))
})

test('validation reports line numbers for bad cells', () => {
  const p = parse('ID,Q1,Q2\n1,1,x\n2,1,5\n', { salt: 's' })
  const bad = p.issues.filter(i => i.severity === 'warning')
  assert.deepEqual(bad.map(i => i.line), [2])
  const p2 = parse('ID,Q1 Points Grade <Numeric MaxPoints:2>,End-of-Line Indicator\n#1,3,#\n', { salt: 's' })
  assert.ok(p2.issues.some(i => i.line === 2 && /above the 2 maximum/.test(i.message)))
})

test('Brightspace Grades export: MaxPoints from the header, End-of-Line ignored', () => {
  const csv = 'OrgDefinedId,Username,Last Name,First Name,Email,Quiz 1 Points Grade <Numeric MaxPoints:10>,Lab Points Grade <Numeric MaxPoints:5>,End-of-Line Indicator\n#001,#ann,Lee,Ann,a@x.ca,8,4,#\n#002,#bob,Roy,Bob,b@x.ca,6,,#\n'
  const p = parse(csv, { salt: 's' })
  assert.equal(p.format, 'd2l-grades')
  assert.deepEqual(p.exam.items.map(i => [i.label, i.maxPoints]), [['Quiz 1', 10], ['Lab', 5]])
  assert.equal(p.exam.attempts[0].lmsId, '001')
  assert.equal(p.exam.attempts[1].username, 'bob')
})

test('Brightspace attempt details (long format) become one row per student with letters and key', () => {
  const h = 'Org Defined ID,Username,FirstName,LastName,Attempt #,Q #,Q Type,Q Text,Answer,Answer Match,Score,Out Of'
  const rows = [
    ['1', 'ann', 'Ann', 'Lee', '1', '1', 'MC', 'Capital of France?', 'Paris', 'Checked', '1', '1'],
    ['1', 'ann', 'Ann', 'Lee', '1', '1', 'MC', 'Capital of France?', 'Lyon', 'Unchecked', '1', '1'],
    ['2', 'bob', 'Bob', 'Roy', '1', '1', 'MC', 'Capital of France?', 'Paris', 'Unchecked', '0', '1'],
    ['2', 'bob', 'Bob', 'Roy', '1', '1', 'MC', 'Capital of France?', 'Lyon', 'Checked', '0', '1'],
    ['2', 'bob', 'Bob', 'Roy', '2', '1', 'MC', 'Capital of France?', 'Paris', 'Checked', '1', '1'],
  ]
  const p = parse([h, ...rows.map(r => r.join(','))].join('\n'), { salt: 's' })
  assert.equal(p.format, 'd2l-attempts')
  assert.equal(p.exam.attempts.length, 2)
  assert.deepEqual(p.exam.attempts.map(a => a.scores[0]), [1, 0])
  assert.deepEqual(p.exam.items[0].options, ['A', 'B'])
  assert.deepEqual(p.exam.items[0].key, ['B'])
  assert.deepEqual(p.exam.attempts.map(a => a.choices![0]), ['B', 'A'])
  assert.ok(p.multipleAttempts)
})

test('Canvas Student Analysis: question and score column pairs', () => {
  const csv = 'name,id,sis_id,section,section_id,section_sis_id,submitted,attempt,101: What is 2+2?,1.0,102: Pick a prime,2.0,n correct,n incorrect,score\nAnn Lee,11,A1,S1,1,,2026-01-01,1,4,1,7,2,2,0,3\nBob Roy,12,A2,S1,1,,2026-01-01,1,5,0,7,2,1,1,2\n'
  const p = parse(csv, { salt: 's' })
  assert.equal(p.format, 'canvas-student')
  assert.deepEqual(p.exam.items.map(i => i.maxPoints), [1, 2])
  assert.deepEqual(p.exam.attempts.map(a => a.scores), [[1, 2], [0, 2]])
  assert.equal(p.exam.attempts[0].lmsId, 'A1')
})

test('Moodle responses with grade columns and the overall average row removed', () => {
  const csv = 'Surname,First name,Email address,State,Started on,Completed,Time taken,Grade/2.00,Q. 1 /1.00,Q. 2 /1.00,Response 1,Response 2\nLee,Ann,a@x.ca,Finished,x,x,x,2,1.00,1.00,Paris,4\nRoy,Bob,b@x.ca,Finished,x,x,x,1,0.00,1.00,Lyon,4\nOverall average,,,,,,,1.5,0.5,1,,\n'
  assert.equal(detect(parseCsv(csv)[0]), 'moodle')
  const p = parse(csv, { salt: 's' })
  assert.equal(p.exam.attempts.length, 2)
  assert.deepEqual(p.exam.attempts.map(a => a.scores), [[1, 1], [0, 1]])
  assert.deepEqual(p.exam.items[0].key, ['B'])
})

test('Canvas Item Analysis is read as a per-question summary', () => {
  const p = parse('Question Id,Question Title,Answered Student Count,Correct Student Ratio,Difficulty Index,Point Biserial of Correct\n1,Mitosis,40,0.8,0.8,0.31\n2,Osmosis,40,0.45,0.45,-0.05\n', { salt: 's' })
  assert.equal(p.format, 'canvas-item')
  assert.deepEqual(p.summary!.map(s => [s.p, s.r]), [[0.8, 0.31], [0.45, -0.05]])
})

test('Brightspace import file: # prefixes, Points Grade header and End-of-Line Indicator', () => {
  const ex = tiny()
  ex.attempts.forEach((a, i) => { a.lmsId = `00${i}`; a.username = `u${i}` })
  const rows = parseCsv(brightspaceCsv(ex, [{ itemId: 'q3', kind: 'full' }], 'Midterm 1', 30))
  assert.deepEqual(rows[0], ['OrgDefinedId', 'Username', 'Midterm 1 Points Grade', 'End-of-Line Indicator'])
  assert.deepEqual(rows[1], ['#000', '#u0', '30', '#'])
  assert.deepEqual(rows[4], ['#003', '#u3', '10', '#'])
})

test('Canvas import file has identity columns and a points-possible row', () => {
  const rows = parseCsv(canvasCsv(tiny(), [], 'Midterm 1 (4512)', 3))
  assert.equal(rows[0][5], 'Midterm 1 (4512)')
  assert.equal(rows[1][0], 'Points Possible')
  assert.equal(rows[2][5], '3')
})

test('class summary shows median and quartiles, never ids', () => {
  const ex = SAMPLES[0].exams()[1].exam
  const txt = classSummary(analyze(ex), 'Midterm 1')
  assert.match(txt, /Median/)
  assert.match(txt, /Middle half/)
  assert.ok(!ex.attempts.some(a => txt.includes(a.id) || (a.name && txt.includes(a.name))))
})

test('item bank: trend links sittings and compare spots the collapsed item', () => {
  const [fall, winter] = SAMPLES[0].exams()
  const a = snapshotOf(fall.exam, [], { id: 'a', title: 'M1', term: fall.term, date: fall.date })
  const b = snapshotOf(winter.exam, [], { id: 'b', title: 'M1', term: winter.term, date: winter.date })
  const tr = trend([b, a])
  assert.equal(tr.length, 40)
  assert.deepEqual(tr[16].points.map(p => p.term), ['Fall 2025', 'Winter 2026'])
  const cmp = compare(a, b)
  assert.match(cmp.rows[16].note, /collapsed/)
  assert.equal(cmp.added, 0)
})

import { useEffect } from 'react'
import { Histogram, ItemMap } from './Charts.tsx'
import { FLAG_SEVERITY, FLAG_TEXT, severity, suggest } from './engine/stats.ts'
import { describeAdj, useExam } from './projectData.ts'
import { useProjects } from './store.ts'
import { f2, fmtDate, Link, NotFound } from './ui.tsx'

export default function Report({ id }: { id: string }) {
  const list = useProjects()
  const p = list?.find(x => x.id === id)
  const examId = new URLSearchParams(location.search).get('exam') ?? p?.exams.at(-1)?.id
  const ex = useExam(p, examId)
  useEffect(() => { if (p && ex.meta) document.title = `Exam quality report · ${p.name} · ${ex.meta.title}` }, [p, ex.meta])
  if (list === null || (p && ex.attempts === undefined)) return <div className="boot"><span className="spinner" /> Preparing report</div>
  if (!p || !ex.meta) return <NotFound />
  if (!ex.analysis) return <div className="page narrow"><p>Student rows for this sitting are not on this device. <Link href={`/app/p/${id}/import`}>Re-import</Link> to print the report.</p></div>
  const m = ex.meta, a = ex.analysis, b = ex.before!, t = a.test
  const label = (i: string) => m.items.find(x => x.id === i)?.label ?? i
  const flagged = b.items.filter(i => severity(i) >= 1).sort((x, y) => severity(y) - severity(x) || x.index - y.index)
  const rel = t.kr20 ?? t.alpha
  const pc = (x: number) => `${((x / (t.maxTotal || 1)) * 100).toFixed(1)}%`
  return (
    <div className="print-page">
      <div className="print-toolbar">
        <Link href={`/app/p/${id}?exam=${m.id}`} className="btn ghost sm">← Back to the course</Link>
        <span className="muted small">For a department chair or curriculum committee. No student is identified.</span>
        <button type="button" className="btn primary sm" onClick={() => print()}>Print or save as PDF</button>
      </div>
      <article className="sheet">
        <div className="muted small">Exam quality report · prepared {new Date().toLocaleDateString('en-US', { dateStyle: 'long' })}</div>
        <h1>{p.course ? `${p.course}: ` : ''}{m.title}</h1>
        <p className="muted">{p.name} · {m.term} · written {fmtDate(m.date)}</p>
        <div className="sheet-meta">
          <div><span>Students</span><b>{t.n}</b></div>
          <div><span>Items</span><b>{t.k}</b></div>
          <div><span>{t.kr20 !== null ? 'KR-20' : 'Cronbach alpha'}</span><b>{f2(rel)}</b></div>
          <div><span>SEM</span><b>{t.sem === null ? '—' : t.sem.toFixed(2)}</b></div>
          <div><span>Median</span><b>{pc(t.median)}</b></div>
          <div><span>Quartiles</span><b>{pc(t.q1)} – {pc(t.q3)}</b></div>
          <div><span>Mean (SD)</span><b>{pc(t.mean)} ({(t.sd / (t.maxTotal || 1) * 100).toFixed(1)})</b></div>
          <div><span>KR-21</span><b>{f2(t.kr21)}</b></div>
        </div>
        <section>
          <h2>Summary</h2>
          <p>
            {rel === null ? 'Reliability could not be estimated.' : `Internal consistency is ${rel >= 0.8 ? 'good' : rel >= 0.7 ? 'acceptable' : 'low'} for a classroom test (${t.kr20 !== null ? 'KR-20' : 'alpha'} ${f2(rel)}). `}
            {flagged.length ? `${flagged.length} of ${t.k} items were flagged for review, ${flagged.filter(i => severity(i) === 2).length} of them serious (likely miskey or negative discrimination).` : 'No items were flagged.'}
            {m.adjustments.length ? ` ${m.adjustments.length} regrade decision${m.adjustments.length > 1 ? 's were' : ' was'} applied: ${m.adjustments.map(x => describeAdj(x, label(x.itemId))).join('; ')}. Class mean moved from ${ex.impact!.meanBefore.toFixed(1)}% to ${ex.impact!.meanAfter.toFixed(1)}%, and ${ex.impact!.changedBand} students changed letter grade.` : ''}
          </p>
          {m.adjustments.length > 0 && <p className="muted small">Statistics above are after regrading. Item statistics below are as originally keyed.</p>}
        </section>
        <section>
          <h2>Item map and score distribution</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16, alignItems: 'center' }}>
            <ItemMap items={b.items} onSelect={() => {}} compact />
            <Histogram bins={t.histogram} before={m.adjustments.length ? b.test.histogram : undefined} />
          </div>
        </section>
        <section>
          <h2>Items needing review</h2>
          {flagged.length === 0 ? <p className="muted">None.</p> : (
            <div className="table-wrap"><table className="data">
              <thead><tr><th>Item</th><th>p</th><th>D</th><th>r</th><th>Flags</th><th>Recommended action</th></tr></thead>
              <tbody>{flagged.map(s => {
                const it = m.items.find(i => i.id === s.id)!
                const sg = suggest(s, it)[0]
                return <tr key={s.id}><th scope="row">{s.label}</th><td>{f2(s.p)}</td><td>{f2(s.d)}</td><td>{f2(s.rCorrected)}</td><td>{s.flags.map(f => <span key={f} className={`flag f${FLAG_SEVERITY[f]}`} style={{ marginRight: 4 }}>{FLAG_TEXT[f]}</span>)}</td><td className="small">{sg ? <><b>{sg.title}.</b> {sg.evidence}</> : ''}</td></tr>
              })}</tbody>
            </table></div>
          )}
        </section>
        <section>
          <h2>All items</h2>
          <div className="table-wrap"><table className="data">
            <thead><tr><th>Item</th><th>Max</th><th>p</th><th>D (27%)</th><th>r pbis</th><th>r corrected</th><th>α if deleted</th></tr></thead>
            <tbody>{b.items.map(s => <tr key={s.id}><th scope="row">{s.label}</th><td>{s.maxPoints}</td><td>{f2(s.p)}</td><td>{f2(s.d)}</td><td>{f2(s.pbis)}</td><td>{f2(s.rCorrected)}</td><td>{f2(s.alphaIfDeleted)}</td></tr>)}</tbody>
          </table></div>
        </section>
        <section>
          <h2>Method</h2>
          <p className="small muted">Difficulty p is the mean score as a share of the item's points. D is the difference in p between the top and bottom 27% of students by total score. r pbis is the Pearson correlation of item score with total score; r corrected removes the item from the total. KR-20 (dichotomous items only), KR-21 and Cronbach's alpha use population variances; SEM = SD × √(1 − reliability). Distractors chosen by under 5% of students are non-functioning. A likely miskey is a distractor chosen more often than the key by the top group and correlating positively with the rest of the test. Blank responses in a score sheet count as zero. A question a student was not given (random pools) or that is still ungraded is left out of that student's score and maximum and of that item's statistics; reliability then uses only students scored on every item. First attempts only.</p>
        </section>
      </article>
    </div>
  )
}

import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { DistractorChart, Histogram, ItemMap, Spark } from './Charts.tsx'
import { brightspaceCsv, canvasCsv, classSummary, compare, missingIds, trend } from './engine/actions.ts'
import { FLAG_SEVERITY, FLAG_TEXT, severity, suggest, type Analysis, type ItemStat } from './engine/stats.ts'
import type { Adjustment, Item } from './engine/types.ts'
import { describeAdj, updateExam, useExam } from './projectData.ts'
import { delAttempts, getAttempts, putAttempts, saveProject, usePrefs, useProjects, type ExamMeta, type Project } from './store.ts'
import { CopyButton, download, Empty, f2, fmtDate, go, isTyping, Link, NotFound, pct, SyntheticBadge, toast } from './ui.tsx'

const Import = lazy(() => import('./Import.tsx'))

const TABS = [['overview', 'Overview'], ['items', 'Items'], ['regrade', 'Regrade'], ['bank', 'Item bank'], ['import', 'Import']] as const

export default function Course({ id, tab }: { id: string; tab: string }) {
  const list = useProjects()
  const p = list?.find(x => x.id === id)
  const q = new URLSearchParams(location.search)
  const exams = useMemo(() => [...(p?.exams ?? [])].sort((a, b) => a.date.localeCompare(b.date) || a.importedAt - b.importedAt), [p?.exams])
  const examId = exams.find(e => e.id === q.get('exam'))?.id ?? exams.at(-1)?.id
  const ex = useExam(p, examId)
  const [sel, setSel] = useState<string | null>(null)

  const href = (t: string, e = examId) => `/app/p/${id}${t === 'overview' ? '' : '/' + t}${e ? `?exam=${e}` : ''}`

  useEffect(() => {
    if (p) document.title = `${p.name} · Item Analysis`
  }, [p?.name])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= TABS.length) { go(href(TABS[n - 1][0]), { keepScroll: true }); return }
      const i = exams.findIndex(x => x.id === examId)
      if (e.key === '[' && i > 0) go(href(tab, exams[i - 1].id), { keepScroll: true })
      if (e.key === ']' && i >= 0 && i < exams.length - 1) go(href(tab, exams[i + 1].id), { keepScroll: true })
      if (e.key === 'p' && examId) go(`/app/p/${id}/report?exam=${examId}`)
      if (e.key === 'Escape') setSel(null)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  if (list === null) return <div className="boot" role="status"><span className="spinner" /> Loading course</div>
  if (!p) return <NotFound />

  const meta = ex.meta
  const flagged = ex.before?.items.filter(i => severity(i) === 2).length ?? meta?.snapshot.items.filter(i => i.flags.includes('miskey') || i.flags.includes('negative')).length ?? 0
  const setAdj = async (adj: Adjustment[], msg?: string) => {
    if (!meta) return
    const prev = meta.adjustments
    await updateExam(p, meta.id, { adjustments: adj })
    if (msg) toast(msg, { undo: () => void updateExam(p, meta.id, { adjustments: prev }) })
  }
  const selItem = sel && ex.analysis ? { s: ex.analysis.items.find(i => i.id === sel) ?? ex.before!.items.find(i => i.id === sel)!, raw: ex.before!.items.find(i => i.id === sel)!, item: meta!.items.find(i => i.id === sel)! } : null

  return (
    <section className="page">
      <div className="course-head">
        <div>
          <div className="eyebrow">{p.course || 'Course'} {p.sampleId && <SyntheticBadge />}</div>
          <h1>{p.name}</h1>
          {meta && <p className="muted" style={{ margin: 0 }}>{meta.title} · {meta.term} · {fmtDate(meta.date)} · {meta.snapshot.n} students · {meta.snapshot.k} items{meta.note ? ` · ${meta.note}` : ''}</p>}
        </div>
        {exams.length > 0 && (
          <div className="exam-pick no-print">
            <label className="sr" htmlFor="exam-sel">Exam sitting</label>
            <select id="exam-sel" value={examId} onChange={e => go(href(tab, e.target.value), { keepScroll: true })}>
              {exams.map(e => <option key={e.id} value={e.id}>{e.term} · {e.title}</option>)}
            </select>
            {meta && !meta.summaryOnly && <Link className="btn ghost" href={`/app/p/${id}/report?exam=${examId}`}>Quality report</Link>}
          </div>
        )}
      </div>

      <nav className="tabs" aria-label="Course sections">
        {TABS.map(([t, l], i) => <Link key={t} href={href(t)} aria-current={tab === t ? 'page' : undefined} title={`${l} (${i + 1})`}>{l}{t === 'items' && flagged > 0 && <span className="count">{flagged}</span>}</Link>)}
      </nav>

      {tab === 'import' || !exams.length ? (
        <Suspense fallback={<div className="boot"><span className="spinner" /></div>}><Import project={p} /></Suspense>
      ) : tab === 'bank' ? (
        <Bank p={p} exams={exams} />
      ) : meta?.summaryOnly ? (
        <Empty title="This sitting is a summary import">
          <p className="muted">Canvas Item Analysis has per-question numbers but no student rows, so it feeds the <Link href={href('bank')}>item bank</Link> only. Import the Student Analysis report for distractors and regrades.</p>
        </Empty>
      ) : ex.attempts === undefined ? (
        <div className="boot" role="status"><span className="spinner" /> Running the analysis</div>
      ) : ex.attempts === null || !ex.analysis ? (
        <Empty title="Student rows are on another device">
          <p className="muted">Synced courses carry items, keys, regrades and statistics, never student data. Re-import this sitting's export here to run regrades and grade files. The <Link href={href('bank')}>item bank</Link> works now.</p>
          <Link className="btn primary" href={href('import')}>Re-import</Link>
        </Empty>
      ) : tab === 'items' ? (
        <Items a={ex.analysis} before={ex.before!} items={meta!.items} onOpen={setSel} />
      ) : tab === 'regrade' ? (
        <Regrade p={p} meta={meta!} ex={ex as Required<typeof ex>} setAdj={setAdj} onOpen={setSel} />
      ) : (
        <Overview a={ex.analysis} before={ex.before!} meta={meta!} onOpen={setSel} sel={sel} regradeHref={href('regrade')} changed={ex.impact!.changedBand} />
      )}

      {selItem && meta && (
        <>
          <div className="drawer-scrim" onClick={() => setSel(null)} />
          <ItemDrawer key={sel} {...selItem} meta={meta} setAdj={setAdj} onClose={() => setSel(null)} onNav={d => {
            const i = meta.items.findIndex(x => x.id === sel)
            const n = meta.items[i + d]
            if (n) setSel(n.id)
          }} />
        </>
      )}
    </section>
  )
}

// ---------- Overview ----------

function Flags({ s }: { s: ItemStat }) {
  return <div className="flags">{[...s.flags].sort((a, b) => FLAG_SEVERITY[b] - FLAG_SEVERITY[a]).map(f => <span key={f} className={`flag f${FLAG_SEVERITY[f]}`}>{FLAG_TEXT[f]}</span>)}</div>
}

function Overview({ a, before, meta, onOpen, sel, regradeHref, changed }: { a: Analysis; before: Analysis; meta: ExamMeta; onOpen(id: string): void; sel: string | null; regradeHref: string; changed: number }) {
  const t = a.test
  const review = before.items.filter(i => severity(i) >= 1).sort((x, y) => severity(y) - severity(x) || x.index - y.index)
  const rel = t.kr20 ?? t.alpha
  const best = [...a.items].filter(i => i.alphaIfDeleted !== null && t.alpha !== null && i.alphaIfDeleted > t.alpha + 0.002).sort((x, y) => y.alphaIfDeleted! - x.alphaIfDeleted!).slice(0, 3)
  return (
    <>
      <div className="kpis">
        <div className="kpi"><span>Students</span><b>{t.n}</b><small>{t.k} items, {+t.maxTotal.toFixed(2)} points</small></div>
        <div className="kpi"><span>{t.kr20 !== null ? 'KR-20' : 'Alpha'}</span><b>{f2(rel)}</b><small>{rel === null ? 'Not enough spread' : rel >= 0.8 ? 'Good for a classroom test' : rel >= 0.7 ? 'Acceptable' : 'Low: scores are noisy'}</small></div>
        <div className="kpi"><span>SEM</span><b>{t.sem === null ? '—' : t.sem.toFixed(1)}</b><small>points, ±{t.sem === null ? '—' : ((t.sem / (t.maxTotal || 1)) * 100).toFixed(1)}% of the scale</small></div>
        <div className="kpi"><span>Median</span><b>{((t.median / (t.maxTotal || 1)) * 100).toFixed(0)}%</b><small>Mean {t.meanPct.toFixed(1)}%, IQR {((t.q1 / t.maxTotal) * 100).toFixed(0)}–{((t.q3 / t.maxTotal) * 100).toFixed(0)}%</small></div>
        <div className={`kpi${review.some(i => severity(i) === 2) ? ' alert' : ''}`}><span>Need review</span><b>{review.length}</b><small>{review.filter(i => severity(i) === 2).length} serious{meta.adjustments.length ? ` · ${meta.adjustments.length} regrade${meta.adjustments.length > 1 ? 's' : ''} applied` : ''}</small></div>
      </div>
      <div className="split">
        <div className="panel">
          <div className="panel-head"><h2>Item map</h2><span className="legend"><span><i style={{ background: 'var(--dot-bad)' }} />Serious</span><span><i style={{ background: 'var(--dot-warn)' }} />Review</span><span><i style={{ background: 'var(--dot-ok)', opacity: .6 }} />Fine</span></span></div>
          <ItemMap items={a.items} selected={sel ?? undefined} onSelect={onOpen} />
          <p className="small muted" style={{ margin: '8px 0 0' }}>x: difficulty p. y: corrected item-total correlation. Click a point for its distractors and fixes. {meta.adjustments.length ? 'Showing scores after your regrades.' : ''}</p>
        </div>
        <div>
          <div className="panel">
            <div className="panel-head"><h2>Review first</h2><span className="muted small">{review.length} of {a.items.length}</span></div>
            {review.length === 0 ? <p className="muted">No items need attention at your thresholds.</p> : (
              <div className="flag-list">
                {review.slice(0, 8).map(s => (
                  <button key={s.id} type="button" className="flag-item" onClick={() => onOpen(s.id)}>
                    <b>{s.label}</b><Flags s={s} /><span className="small muted num">p {f2(s.p)}</span>
                  </button>
                ))}
                {review.length > 8 && <span className="small muted">and {review.length - 8} more on the Items tab</span>}
              </div>
            )}
          </div>
          <div className="panel">
            <div className="panel-head"><h2>Score distribution</h2>{meta.adjustments.length > 0 && <Link className="small" href={regradeHref}>{changed} grade change{changed === 1 ? '' : 's'} from regrades</Link>}</div>
            <Histogram bins={t.histogram} before={meta.adjustments.length ? before.test.histogram : undefined} />
            {best.length > 0 && <p className="small muted" style={{ margin: '10px 0 0' }}>Alpha would rise most without {best.map(i => `${i.label} (${f2(i.alphaIfDeleted)})`).join(', ')}.</p>}
          </div>
        </div>
      </div>
    </>
  )
}

// ---------- Items table ----------

type SortKey = 'index' | 'p' | 'd' | 'pbis' | 'rCorrected' | 'alphaIfDeleted' | 'sev'
function Items({ a, before, items, onOpen }: { a: Analysis; before: Analysis; items: Item[]; onOpen(id: string): void }) {
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: 'index', dir: 1 })
  const [only, setOnly] = useState(false)
  const [q, setQ] = useState('')
  const rows = a.items
    .map(s => ({ s, raw: before.items.find(x => x.id === s.id)!, item: items.find(i => i.id === s.id)! }))
    .filter(r => (!only || severity(r.raw) >= 1) && (!q || `${r.s.label} ${r.item.stem ?? ''}`.toLowerCase().includes(q.toLowerCase())))
    .sort((x, y) => {
      const v = (r: typeof x) => (sort.k === 'sev' ? severity(r.raw) : sort.k === 'index' ? r.s.index : (r.s[sort.k] as number | null) ?? -9)
      return (v(x) - v(y)) * sort.dir
    })
  const th = (k: SortKey, label: string, title?: string) => (
    <th aria-sort={sort.k === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} title={title}>
      <button type="button" className="linkish" style={{ font: 'inherit', color: 'inherit', textTransform: 'inherit' }} onClick={() => setSort(s => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : k === 'index' ? 1 : -1 }))}>{label}{sort.k === k ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</button>
    </th>
  )
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>All items</h2>
        <div className="row gap-sm wrap">
          <input type="search" placeholder="Search items" aria-label="Search items" value={q} onChange={e => setQ(e.target.value)} style={{ width: 200, minHeight: 36, padding: '6px 10px' }} />
          <label className="row gap-sm small"><input type="checkbox" checked={only} onChange={e => setOnly(e.target.checked)} /> Flagged only</label>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr>{th('index', 'Item')}<th>Question</th><th>Key</th>{th('p', 'p', 'Difficulty: share of points earned')}{th('d', 'D', 'Upper minus lower 27%')}{th('pbis', 'r pbis', 'Point-biserial with total')}{th('rCorrected', 'r corr', 'Corrected item-total r')}{th('alphaIfDeleted', 'α if del')}{th('sev', 'Flags')}</tr></thead>
          <tbody>
            {rows.map(({ s, raw, item }) => (
              <tr key={s.id} className={severity(raw) === 2 ? 'row-bad' : ''} style={{ cursor: 'pointer' }} onClick={() => onOpen(s.id)}>
                <th scope="row"><button type="button" className="linkish" onClick={e => { e.stopPropagation(); onOpen(s.id) }}><b>{s.label}</b></button></th>
                <td className="small" style={{ maxWidth: 320 }}>{item.stem?.split('\n')[0] ?? <span className="muted">No text in export</span>}</td>
                <td className="mono">{item.key?.join(',') ?? (item.maxPoints !== 1 ? `${item.maxPoints} pt` : '')}</td>
                <td className="num">{f2(s.p)}</td>
                <td className="num">{f2(s.d)}</td>
                <td className="num">{f2(s.pbis)}</td>
                <td className="num">{f2(s.rCorrected)}</td>
                <td className="num">{f2(s.alphaIfDeleted)}</td>
                <td><Flags s={raw} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="muted">No items match.</p>}
    </div>
  )
}

// ---------- Item drawer ----------

function ItemDrawer({ s, raw, item, meta, setAdj, onClose, onNav }: { s: ItemStat; raw: ItemStat; item: Item; meta: ExamMeta; setAdj(a: Adjustment[], msg?: string): Promise<void>; onClose(): void; onNav(d: 1 | -1): void }) {
  const cur = meta.adjustments.find(a => a.itemId === item.id)
  const sugg = suggest(raw, item)
  const apply = (a: Adjustment | null) => {
    const rest = meta.adjustments.filter(x => x.itemId !== item.id)
    void setAdj(a ? [...rest, a] : rest, a ? describeAdj(a, item.label) : `Regrade on ${item.label} removed`)
  }
  const distractorOpts = (item.options ?? []).filter(o => !item.key?.includes(o))
  return (
    <aside className="drawer" role="dialog" aria-label={`Item ${item.label}`}>
      <div className="row between" style={{ marginBottom: 10 }}>
        <div className="row gap-sm"><button type="button" className="icon-btn" aria-label="Previous item" onClick={() => onNav(-1)}>‹</button><h2 style={{ margin: 0 }}>{item.label}</h2><button type="button" className="icon-btn" aria-label="Next item" onClick={() => onNav(1)}>›</button></div>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>&times;</button>
      </div>
      <Flags s={raw} />
      {item.stem && <p className="stem" style={{ marginTop: 12 }}>{item.stem}</p>}
      <div className="metrics">
        <div><span>p</span><b>{f2(s.p)}</b></div>
        <div><span>D (27%)</span><b>{f2(s.d)}</b></div>
        <div><span>r corrected</span><b>{f2(s.rCorrected)}</b></div>
        <div><span>α if deleted</span><b>{f2(s.alphaIfDeleted)}</b></div>
      </div>
      {raw.options.length > 0 && (
        <>
          <h3>Distractors</h3>
          <DistractorChart options={s.options} suspect={raw.suspect} />
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="data">
              <thead><tr><th>Option</th><th>All</th><th>Upper 27%</th><th>Lower 27%</th><th>r</th></tr></thead>
              <tbody>{s.options.map(o => <tr key={o.option}><th scope="row"><b>{o.option}</b>{o.isKey ? ' ✓ key' : o.option === raw.suspect ? ' suspect' : ''}</th><td className="num">{pct(o.all)}</td><td className="num">{pct(o.upper)}</td><td className="num">{pct(o.lower)}</td><td className="num">{f2(o.r)}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
      <h3 style={{ marginTop: 20 }}>Suggested fixes</h3>
      {sugg.length === 0 && <p className="muted small">Nothing to fix. This item behaves.</p>}
      {sugg.map((g, i) => (
        <div key={i} className="suggestion">
          <h4>{g.title}</h4>
          <p>{g.evidence}</p>
          {g.action && <button type="button" className="btn ghost sm" onClick={() => apply(g.action!)}>{describeAdj(g.action, item.label)}</button>}
        </div>
      ))}
      <h3 style={{ marginTop: 20 }}>Regrade this item</h3>
      <div className="seg-control" role="radiogroup" aria-label="Regrade">
        <button type="button" role="radio" aria-checked={!cur} className={!cur ? 'on' : ''} onClick={() => apply(null)}>As keyed</button>
        <button type="button" role="radio" aria-checked={cur?.kind === 'drop'} className={cur?.kind === 'drop' ? 'on' : ''} onClick={() => apply({ itemId: item.id, kind: 'drop' })}>Drop</button>
        <button type="button" role="radio" aria-checked={cur?.kind === 'full'} className={cur?.kind === 'full' ? 'on' : ''} onClick={() => apply({ itemId: item.id, kind: 'full' })}>Full credit</button>
      </div>
      {distractorOpts.length > 0 && (
        <fieldset style={{ border: 0, padding: 0, margin: '12px 0 0' }}>
          <legend className="small muted">Also accept</legend>
          <div className="row gap wrap">
            {distractorOpts.map(o => (
              <label key={o} className="row gap-sm"><input type="checkbox" checked={cur?.kind === 'accept' && !!cur.accept?.includes(o)} onChange={e => {
                const prev = cur?.kind === 'accept' ? cur.accept ?? [] : []
                const next = e.target.checked ? [...prev, o] : prev.filter(x => x !== o)
                apply(next.length ? { itemId: item.id, kind: 'accept', accept: next.sort() } : null)
              }} /> {o}</label>
            ))}
          </div>
        </fieldset>
      )}
      <p className="small muted" style={{ marginTop: 16 }}>Keys: <kbd>Esc</kbd> close. Regrades are saved to this sitting and can be undone.</p>
    </aside>
  )
}

// ---------- Regrade ----------

function Regrade({ p, meta, ex, setAdj, onOpen }: { p: Project; meta: ExamMeta; ex: Required<ReturnType<typeof useExam>>; setAdj(a: Adjustment[], msg?: string): Promise<void>; onOpen(id: string): void }) {
  const prefs = usePrefs()
  const im = ex.impact!
  const [gradeItem, setGradeItem] = useState(meta.gradeItem ?? meta.title)
  const [outOf, setOutOf] = useState(meta.outOf ?? prefs.outOf)
  const [assignment, setAssignment] = useState(`${meta.title} (assignment id)`)
  const [showAll, setShowAll] = useState(false)
  const label = (id: string) => meta.items.find(i => i.id === id)?.label ?? id
  const changed = im.students.filter(s => Math.abs(s.after - s.before) > 1e-9)
  const nameOf = new Map(ex.attempts!.map(a => [a.id, prefs.showNames && a.name ? a.name : a.id]))
  const shown = (showAll ? im.students : changed).slice().sort((a, b) => (b.after - b.before) - (a.after - a.before))
  const noIds = missingIds(ex.exam!)
  const note = meta.adjustments.length ? `Regraded: ${meta.adjustments.map(a => describeAdj(a, label(a.itemId))).join('; ')}.` : undefined
  const summary = classSummary(ex.analysis!, `${meta.title} (${meta.term})`, note)
  const save = (patch: Partial<ExamMeta>) => void updateExam(p, meta.id, patch)
  const file = (s: string) => s.replace(/[^\w-]+/g, '-').replace(/-+/g, '-').toLowerCase()

  return (
    <>
      <div className="panel">
        <div className="panel-head"><h2>Regrade decisions</h2>{meta.adjustments.length > 0 && <button type="button" className="btn ghost sm" onClick={() => void setAdj([], 'All regrades cleared')}>Clear all</button>}</div>
        {meta.adjustments.length === 0 ? <p className="muted">No regrades yet. Open a flagged item from the Overview or Items tab and choose drop, full credit or an extra accepted answer. Nothing changes in your LMS until you import the file below.</p> : (
          <div className="adj-list">
            {meta.adjustments.map(a => (
              <div key={a.itemId} className="adj"><span>{describeAdj(a, label(a.itemId))} <button type="button" className="linkish small" onClick={() => onOpen(a.itemId)}>Open item</button></span>
                <button type="button" className="btn ghost sm" onClick={() => void setAdj(meta.adjustments.filter(x => x !== a), `Removed regrade on ${label(a.itemId)}`)}>Remove</button></div>
            ))}
          </div>
        )}
      </div>

      <div className="grid-2">
        <div className="panel">
          <h2>Grade bands</h2>
          <div className="table-wrap">
            <table className="data band-table">
              <thead><tr><th>Band</th><th>Before</th><th>After</th><th>Change</th></tr></thead>
              <tbody>{im.bands.map(b => <tr key={b.label}><th scope="row"><b>{b.label}</b></th><td className="num">{b.before}</td><td className="num">{b.after}</td><td className={`num delta ${b.after > b.before ? 'up' : b.after < b.before ? 'down' : ''}`}>{b.after === b.before ? '·' : (b.after > b.before ? '+' : '−') + Math.abs(b.after - b.before)}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="small muted" style={{ margin: '10px 0 0' }}>Class mean {im.meanBefore.toFixed(1)}% → <b>{im.meanAfter.toFixed(1)}%</b>. {im.raised} students raised, {im.changedBand} change letter grade. Bands: {p.bands.map(b => `${b.label} ≥ ${b.min}`).join(', ')} (<Link href="/settings#bands">edit</Link>).</p>
        </div>
        <div className="panel">
          <h2>Distribution</h2>
          <Histogram bins={ex.analysis!.test.histogram} before={meta.adjustments.length ? ex.before!.test.histogram : undefined} />
          <p className="small muted" style={{ margin: '8px 0 0' }}>Alpha {f2(ex.before!.test.alpha)} → <b>{f2(ex.analysis!.test.alpha)}</b>. Grey bars are scores before regrading.</p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Students</h2><label className="row gap-sm small"><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> Show unchanged students</label></div>
        {shown.length === 0 ? <p className="muted">No scores change with the current decisions.</p> : (
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table className="data">
              <thead><tr><th>Student</th><th>Before</th><th>After</th><th>Change</th><th>Grade</th></tr></thead>
              <tbody>{shown.map(s => <tr key={s.id}><th scope="row" className="mono">{nameOf.get(s.id)}</th><td className="num">{s.before.toFixed(1)}%</td><td className="num">{s.after.toFixed(1)}%</td><td className={`num delta ${s.after > s.before + 1e-9 ? 'up' : s.after < s.before - 1e-9 ? 'down' : ''}`}>{s.after === s.before ? '·' : `${s.after > s.before ? '+' : '−'}${Math.abs(s.after - s.before).toFixed(1)}`}</td><td>{s.bandBefore === s.bandAfter ? s.bandBefore : <b>{s.bandBefore} → {s.bandAfter}</b>}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        <p className="small muted" style={{ margin: '10px 0 0' }}>Students are shown by pseudonym{prefs.showNames ? ' or name' : ''}. {meta.namesDropped ? 'Names were dropped at import.' : <Link href="/settings#privacy">Name display settings</Link>}</p>
      </div>

      <div className="panel">
        <h2>Grade import files</h2>
        <p className="muted small">Scores are written on the grade item's own scale after your regrades. Check the item name matches your gradebook exactly. {noIds > 0 && <span className="warn-text">{noIds} students have no OrgDefinedId or username in the import and will be blank.</span>}</p>
        <div className="form-grid">
          <label className="field"><span>Brightspace grade item name</span><input value={gradeItem} onChange={e => setGradeItem(e.target.value)} onBlur={() => save({ gradeItem })} /><small>Column becomes “{gradeItem} Points Grade”.</small></label>
          <label className="field"><span>Points out of</span><input type="number" min={1} step="any" value={outOf} onChange={e => setOutOf(Number(e.target.value) || 1)} onBlur={() => save({ outOf })} /><small>The grade item's maximum points.</small></label>
        </div>
        <div className="row gap wrap" style={{ marginTop: 14 }}>
          <button type="button" className="btn primary" onClick={() => download(`${file(gradeItem)}-brightspace-import.csv`, brightspaceCsv(ex.exam!, meta.adjustments, gradeItem, outOf))}>Brightspace Grades CSV</button>
          <label className="field" style={{ flex: '1 1 220px', margin: 0 }}><span className="sr">Canvas assignment column</span><input value={assignment} onChange={e => setAssignment(e.target.value)} aria-label="Canvas assignment column header" /></label>
          <button type="button" className="btn ghost" onClick={() => download(`${file(meta.title)}-canvas-import.csv`, canvasCsv(ex.exam!, meta.adjustments, assignment, outOf))}>Canvas gradebook CSV</button>
        </div>
        <p className="small muted" style={{ margin: '10px 0 0' }}>The file holds LMS ids, so it is built here and never uploaded. <Link href="/docs#regrade">How to import it</Link>.</p>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Class summary for students</h2><div className="row gap-sm"><CopyButton text={summary} /><button type="button" className="btn ghost sm" onClick={() => download(`${file(meta.title)}-class-summary.txt`, summary, 'text/plain')}>Download</button></div></div>
        <pre className="code" style={{ padding: 14, whiteSpace: 'pre-wrap', margin: 0 }}>{summary}</pre>
      </div>
    </>
  )
}

// ---------- Item bank ----------

function Bank({ p, exams }: { p: Project; exams: ExamMeta[] }) {
  const snaps = exams.map(e => ({ ...e.snapshot, id: e.id, title: e.title, term: e.term, date: e.date }))
  const rows = trend(snaps)
  const [a, setA] = useState(exams.at(-2)?.id ?? exams[0].id)
  const [b, setB] = useState(exams.at(-1)!.id)
  const sa = snaps.find(s => s.id === a), sb = snaps.find(s => s.id === b)
  const cmp = sa && sb && a !== b ? compare(sa, sb) : null
  const [onlyChanged, setOnlyChanged] = useState(true)

  const removeExam = async (e: ExamMeta) => {
    const data = await getAttempts(e.id)
    await saveProject({ ...p, exams: p.exams.filter(x => x.id !== e.id) })
    await delAttempts(e.id)
    toast(`Removed ${e.term} · ${e.title}`, { undo: async () => { if (data) await putAttempts(e.id, data); await saveProject({ ...p }) } })
    go(`/app/p/${p.id}/bank`, { keepScroll: true })
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head"><h2>Sittings</h2><span className="muted small">{exams.length} snapshot{exams.length > 1 ? 's' : ''}</span></div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Term</th><th>Exam</th><th>Date</th><th>Students</th><th>Items</th><th>Reliability</th><th>Median</th><th>Regrades</th><th /></tr></thead>
            <tbody>{exams.map(e => (
              <tr key={e.id}>
                <th scope="row">{e.term}</th><td><Link href={`/app/p/${p.id}?exam=${e.id}`}>{e.title}</Link>{e.summaryOnly && <span className="badge" style={{ marginLeft: 6 }}>Summary</span>}</td><td>{fmtDate(e.date)}</td>
                <td className="num">{e.snapshot.n}</td><td className="num">{e.snapshot.k}</td><td className="num">{f2(e.snapshot.kr20 ?? e.snapshot.alpha)}</td><td className="num">{e.summaryOnly ? '—' : `${e.snapshot.medianPct.toFixed(0)}%`}</td><td className="num">{e.adjustments.length || '·'}</td>
                <td><button type="button" className="btn danger-ghost sm" onClick={() => void removeExam(e)}>Remove</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      {exams.length > 1 && (
        <div className="panel">
          <div className="panel-head">
            <h2>Compare sittings</h2>
            <div className="row gap-sm wrap">
              <select aria-label="Earlier sitting" value={a} onChange={e => setA(e.target.value)} style={{ width: 'auto' }}>{exams.map(e => <option key={e.id} value={e.id}>{e.term} · {e.title}</option>)}</select>
              <span aria-hidden="true">→</span>
              <select aria-label="Later sitting" value={b} onChange={e => setB(e.target.value)} style={{ width: 'auto' }}>{exams.map(e => <option key={e.id} value={e.id}>{e.term} · {e.title}</option>)}</select>
            </div>
          </div>
          {!cmp ? <p className="muted">Pick two different sittings.</p> : (
            <>
              <p className="small muted">Reliability {f2(cmp.alpha[0])} → <b>{f2(cmp.alpha[1])}</b>. {cmp.added} new item{cmp.added === 1 ? '' : 's'}, {cmp.removed} retired. Items are matched by question text, or by label when the export has no text.</p>
              <label className="row gap-sm small" style={{ marginBottom: 8 }}><input type="checkbox" checked={onlyChanged} onChange={e => setOnlyChanged(e.target.checked)} /> Changed items only</label>
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Item</th><th>Question</th><th>p</th><th>Δp</th><th>r</th><th>Δr</th><th>What changed</th></tr></thead>
                  <tbody>{cmp.rows.filter(r => !onlyChanged || r.note !== 'Stable').map(r => (
                    <tr key={r.bankKey} className={/collapsed/.test(r.note) ? 'row-bad' : ''}>
                      <th scope="row"><b>{r.label}</b></th><td className="small" style={{ maxWidth: 300 }}>{r.stem}</td>
                      <td className="num">{f2(r.a?.p)} → {f2(r.b?.p)}</td><td className={`num delta ${(r.dp ?? 0) > 0 ? 'up' : (r.dp ?? 0) < 0 ? 'down' : ''}`}>{f2(r.dp)}</td>
                      <td className="num">{f2(r.a?.r)} → {f2(r.b?.r)}</td><td className={`num delta ${(r.dr ?? 0) > 0 ? 'up' : (r.dr ?? 0) < 0 ? 'down' : ''}`}>{f2(r.dr)}</td>
                      <td className="small">{r.note}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      <div className="panel">
        <div className="panel-head"><h2>Item trends</h2><span className="muted small">{rows.length} items across {exams.length} sitting{exams.length > 1 ? 's' : ''}</span></div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Item</th><th>Question</th><th>Difficulty p by term</th><th>Discrimination r by term</th><th>Latest</th></tr></thead>
            <tbody>{rows.map(r => {
              const last = r.points.at(-1)!
              return (
                <tr key={r.bankKey} className="trend-row">
                  <th scope="row"><b>{r.label}</b></th>
                  <td className="small" style={{ maxWidth: 320 }}>{r.stem}</td>
                  <td><Spark values={r.points.map(x => x.p)} /></td>
                  <td><Spark values={r.points.map(x => x.r)} lo={-0.4} hi={0.8} bad={r.points.map(x => (x.r ?? 0) < 0)} /></td>
                  <td className="small num">p {f2(last.p)} · r {f2(last.r)} <span className="muted">({r.points.length} sitting{r.points.length > 1 ? 's' : ''})</span>{last.flags.filter(f => FLAG_SEVERITY[f] === 2).map(f => <span key={f} className="flag f2" style={{ marginLeft: 6 }}>{FLAG_TEXT[f]}</span>)}</td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      </div>
    </>
  )
}

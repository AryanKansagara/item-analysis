import { useMemo, useRef, useState } from 'react'
import { FORMAT_LABEL, parse, type Format } from './engine/importer.ts'
import { addExam } from './projectData.ts'
import { getPrefs, saveProject, type Project } from './store.ts'
import { go, Link, toast } from './ui.tsx'

const MAX_BYTES = 40_000_000

function guessTerm(d = new Date()) {
  const m = d.getMonth()
  return `${m < 4 ? 'Winter' : m < 8 ? 'Summer' : 'Fall'} ${d.getFullYear()}`
}

export default function Import({ project }: { project: Project }) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null)
  const [over, setOver] = useState(false)
  const [format, setFormat] = useState<Format | ''>('')
  const [idColumn, setIdColumn] = useState('')
  const [ignore, setIgnore] = useState<string[]>([])
  const [key, setKey] = useState('')
  const [paste, setPaste] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const last = project.exams.at(-1)
  const [info, setInfo] = useState({ title: last?.title ?? 'Midterm 1', term: guessTerm(), date: new Date().toISOString().slice(0, 10), dropNames: getPrefs().dropNames })
  const [names, setNames] = useState({ name: project.name, course: project.course })

  const parsed = useMemo(() => file ? parse(file.text, { salt: project.salt, format: format || undefined, idColumn: idColumn || undefined, ignore, key: key || undefined }) : null, [file, format, idColumn, ignore, key, project.salt])
  const errors = parsed?.issues.filter(i => i.severity === 'error') ?? []
  const keyed = parsed?.exam.items.filter(i => i.key?.length).length ?? 0
  const hasNames = parsed?.exam.attempts.some(a => a.name)

  const read = async (f: File) => {
    setErr(null)
    if (f.size > MAX_BYTES) { setErr(`${f.name} is ${(f.size / 1e6).toFixed(0)} MB. The limit is 40 MB; export one quiz at a time.`); return }
    if (/\.(xlsx?|zip|pdf)$/i.test(f.name)) { setErr('That looks like a spreadsheet or archive. Save it as CSV (UTF-8) and try again.'); return }
    const text = await f.text()
    setFile({ name: f.name, text }); setFormat(''); setIdColumn(''); setIgnore([]); setKey('')
    const t = f.name.replace(/\.(csv|txt|tsv)$/i, '').replace(/[_-]+/g, ' ').trim()
    if (t && !last) setInfo(i => ({ ...i, title: t.slice(0, 60) }))
  }

  const run = async () => {
    if (!parsed || errors.length) return
    setBusy(true)
    try {
      const p = names.name !== project.name || names.course !== project.course ? await saveProject({ ...project, ...names }) : project
      const { examId } = await addExam(p, parsed, { ...info, fileName: file!.name })
      toast(`Imported ${parsed.summary ? parsed.summary.length + ' questions' : parsed.exam.attempts.length + ' students'} from ${file!.name}`, { tone: 'ok' })
      go(`/app/p/${p.id}${parsed.summary ? '/bank' : ''}?exam=${examId}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <div>
        <div className="panel">
          <div className="panel-head"><h2>1. Choose the export</h2><Link href="/docs#exports" className="small">How to export from Brightspace, Canvas or Moodle</Link></div>
          {!paste ? (
            <div
              className={`drop${over ? ' over' : ''}`} role="button" tabIndex={0}
              onClick={() => input.current?.click()} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click() } }}
              onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
              onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void read(f) }}
            >
              <strong>{file ? file.name : 'Drop a CSV here'}</strong>
              <span className="muted small">{file ? 'Drop another file to replace it' : 'or click to choose. Brightspace, Canvas, Moodle or a generic student × item sheet.'}</span>
              <input ref={input} type="file" accept=".csv,.txt,.tsv,text/csv" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = '' }} />
            </div>
          ) : (
            <label className="field"><span>Paste CSV</span><textarea rows={8} placeholder={'Student,Q1,Q2,Q3\nKEY,B,D,A\nS001,B,D,C'} onChange={e => setFile(e.target.value.trim() ? { name: 'pasted.csv', text: e.target.value } : null)} /></label>
          )}
          <div className="row between" style={{ marginTop: 10 }}>
            <button type="button" className="linkish small" onClick={() => setPaste(!paste)}>{paste ? 'Upload a file instead' : 'Paste text instead'}</button>
            <span className="muted small">Read in your browser. Nothing is uploaded.</span>
          </div>
          {err && <p className="error small" role="alert">{err}</p>}
        </div>

        {parsed && (
          <div className="panel">
            <div className="panel-head"><h2>2. Check the mapping</h2><span className="chip info">{FORMAT_LABEL[parsed.format]}</span></div>
            <div className="form-grid">
              <label className="field"><span>Format</span>
                <select value={format || parsed.format} onChange={e => setFormat(e.target.value as Format)}>{(Object.keys(FORMAT_LABEL) as Format[]).map(f => <option key={f} value={f}>{FORMAT_LABEL[f]}{f === parsed.format && !format ? ' (detected)' : ''}</option>)}</select>
              </label>
              {(parsed.format === 'generic' || parsed.format === 'd2l-grades') && (
                <label className="field"><span>Student id column</span>
                  <select value={idColumn || parsed.columns.find(c => c.role === 'id')?.name || ''} onChange={e => setIdColumn(e.target.value)}>{parsed.columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}</select>
                </label>
              )}
            </div>
            {!parsed.summary && (
              <>
                <p className="small muted" style={{ margin: '14px 0 6px' }}>Columns{parsed.format === 'generic' || parsed.format === 'd2l-grades' ? ' (click an item column to leave it out)' : ''}:</p>
                <div className="col-chips">
                  {parsed.columns.slice(0, 80).map(c => (
                    <button key={c.name} type="button" className={`col-chip ${c.role}`} title={c.role} disabled={!(parsed.format === 'generic' || parsed.format === 'd2l-grades') || c.role === 'id' || c.role === 'name'}
                      onClick={() => setIgnore(ig => ig.includes(c.name) ? ig.filter(x => x !== c.name) : [...ig, c.name])}>{c.name.length > 32 ? c.name.slice(0, 30) + '…' : c.name}</button>
                  ))}
                  {parsed.columns.length > 80 && <span className="small muted">and {parsed.columns.length - 80} more</span>}
                </div>
                <div className="legend" style={{ marginTop: 8 }}><span><i style={{ background: 'var(--blue)' }} />Student id</span><span><i style={{ background: 'var(--info-line)' }} />Name (hashed)</span><span><i style={{ background: 'var(--good-line)' }} />Item</span><span><i style={{ background: 'var(--line)' }} />Ignored</span></div>
              </>
            )}
            {parsed.exam.items.some(i => i.options) && parsed.format === 'generic' && (
              <label className="field" style={{ marginTop: 14 }}><span>Answer key (if the file has no KEY row)</span><input placeholder="B, D, A, C, …" value={key} onChange={e => setKey(e.target.value)} /><small>One letter per item in column order. Use B/C to accept two answers.</small></label>
            )}
          </div>
        )}
      </div>

      <div>
        {parsed && (
          <div className="panel">
            <div className="panel-head"><h2>3. Validation</h2><span className={`chip ${errors.length ? 'critical' : 'good'}`}>{errors.length ? `${errors.length} error${errors.length > 1 ? 's' : ''}` : 'Ready'}</span></div>
            <dl className="mini-stats" style={{ marginBottom: 14 }}>
              {parsed.summary ? <div><dt>Questions</dt><dd>{parsed.summary.length}</dd></div> : <>
                <div><dt>Students</dt><dd>{parsed.exam.attempts.length}</dd></div>
                <div><dt>Items</dt><dd>{parsed.exam.items.length}</dd></div>
                <div><dt>With choices</dt><dd>{keyed ? `${keyed} keyed` : 'Scores only'}</dd></div>
              </>}
            </dl>
            {parsed.issues.length === 0 ? <p className="muted small">No problems found.</p> : (
              <div className="issues" role="list">
                {parsed.issues.slice(0, 200).map((i, n) => (
                  <div key={n} className="issue" role="listitem"><span className="mono small">{i.line ? `Line ${i.line}` : 'File'}</span><span className={`chip ${i.severity === 'error' ? 'critical' : i.severity === 'warning' ? 'warn' : 'neutral'}`}>{i.severity}</span><span>{i.message}</span></div>
                ))}
                {parsed.issues.length > 200 && <div className="issue"><span /><span /><span className="muted">{parsed.issues.length - 200} more</span></div>}
              </div>
            )}
          </div>
        )}

        <div className="panel">
          <h2>{parsed ? '4. Name this sitting' : 'Course'}</h2>
          <div className="form-grid">
            <label className="field"><span>Course name</span><input value={names.name} onChange={e => setNames({ ...names, name: e.target.value })} /></label>
            <label className="field"><span>Course code</span><input value={names.course} placeholder="BIO 110" onChange={e => setNames({ ...names, course: e.target.value })} /></label>
            {parsed && <>
              <label className="field"><span>Exam</span><input value={info.title} onChange={e => setInfo({ ...info, title: e.target.value })} /></label>
              <label className="field"><span>Term</span><input value={info.term} onChange={e => setInfo({ ...info, term: e.target.value })} /></label>
              <label className="field"><span>Date written</span><input type="date" value={info.date} onChange={e => setInfo({ ...info, date: e.target.value })} /></label>
            </>}
          </div>
          {parsed && !parsed.summary && (
            <fieldset style={{ border: 0, padding: 0, margin: '16px 0 0' }}>
              <legend className="small"><b>Student names</b></legend>
              <p className="small muted" style={{ margin: '4px 0 8px' }}>Every student gets a pseudonym (e.g. {parsed.exam.attempts[0]?.id ?? 'S-4K2QZ1'}). The LMS id stays on this device so the regrade file can be imported back. Names and scores never sync.</p>
              <label className="toggle"><input type="radio" name="names" checked={!info.dropNames} onChange={() => setInfo({ ...info, dropNames: false })} disabled={!hasNames} /><span className="small">Keep names on this device (hidden unless you turn them on in Settings)</span></label>
              <label className="toggle" style={{ marginTop: 6 }}><input type="radio" name="names" checked={info.dropNames || !hasNames} onChange={() => setInfo({ ...info, dropNames: true })} /><span className="small">Drop names now{!hasNames ? ' (this file has none)' : ''}</span></label>
            </fieldset>
          )}
          <div className="row gap wrap" style={{ marginTop: 18 }}>
            {parsed ? <button type="button" className="btn primary" disabled={busy || errors.length > 0 || (!parsed.summary && !parsed.exam.attempts.length)} onClick={() => void run()}>{busy ? 'Importing' : 'Import and analyse'}</button>
              : <button type="button" className="btn ghost" onClick={async () => { await saveProject({ ...project, ...names }); toast('Saved', { tone: 'ok', ttl: 1500 }) }}>Save course details</button>}
          </div>
        </div>
      </div>
    </div>
  )
}

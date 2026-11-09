import { useEffect, useState } from 'react'
import { SAMPLES } from './engine/sample.ts'
import { createBlankProject, createSampleProject } from './projectData.ts'
import { deleteProject, saveProject, useProjects, type Project } from './store.ts'
import { useSync } from './sync.ts'
import { ask, f2, fmtDate, go, Link, SyntheticBadge, toast } from './ui.tsx'
import { Spark } from './Charts.tsx'

export default function Workspace() {
  const list = useProjects()
  const sync = useSync()
  const [busy, setBusy] = useState<string | null>(null)

  // /app?sample=bio110 opens (or creates) the sample straight away.
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    const s = q.get('sample')
    const tab = q.get('tab')?.replace(/[^a-z]/g, '')
    if (!s || list === null || busy) return
    if (!SAMPLES.some(x => x.id === s)) return
    setBusy(s)
    void createSampleProject(s).then(p => go(`/app/p/${p.id}${tab ? '/' + tab : ''}`, { replace: true }))
  }, [list, busy])

  const openSample = async (id: string) => { setBusy(id); const p = await createSampleProject(id); go(`/app/p/${p.id}`) }
  const newProject = async () => {
    const n = (list?.filter(p => !p.sampleId).length ?? 0) + 1
    const p = await createBlankProject(n === 1 ? 'My course' : `Course ${n}`)
    go(`/app/p/${p.id}/import`)
  }

  if (list === null || busy) return <div className="boot" role="status"><span className="spinner" /> {busy ? 'Building the synthetic course' : 'Opening your courses'}</div>

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1>Courses</h1>
          <p className="muted">One course per item bank. Each exam sitting you import is kept as a dated snapshot, so the same question can be followed term over term. {sync.user ? 'Course settings and statistics sync to your account; student rows stay here.' : 'Stored in this browser only.'}</p>
        </div>
        {list.length > 0 && <button type="button" className="btn primary" onClick={newProject}>New course</button>}
      </div>

      {list.length === 0 ? (
        <div className="onboard">
          <article className="onboard-card feature">
            <div className="eyebrow on-dark">Two minutes</div>
            <h2>Try a sample course</h2>
            <p>Synthetic exams with realistic problems already in them. Open one, click the red dot, run the regrade.</p>
            <div className="stack-sm">
              {SAMPLES.map(s => (
                <button key={s.id} type="button" className="sample-btn" onClick={() => void openSample(s.id)}>
                  <span><strong>{s.name}</strong><small>{s.blurb}</small></span><span aria-hidden="true">&rarr;</span>
                </button>
              ))}
            </div>
          </article>
          <article className="onboard-card">
            <div className="eyebrow">Your quiz</div>
            <h2>Import your data</h2>
            <p>Export the quiz's question details from Brightspace (or Canvas Student Analysis, or Moodle responses), then drop the CSV in. The format is detected, columns are mapped, and every problem is listed with its line number.</p>
            <div className="row gap wrap">
              <button type="button" className="btn primary" onClick={newProject}>Import your data</button>
              <Link href="/docs" className="btn ghost">How to export</Link>
            </div>
            <p className="muted small" style={{ marginTop: 16 }}>Files are read in your browser. Student names are replaced with pseudonyms and never uploaded.</p>
          </article>
        </div>
      ) : (
        <>
          <div className="project-grid">{list.map(p => <ProjectCard key={p.id} p={p} />)}</div>
          <div className="samples-row">
            <span className="muted small">Sample courses:</span>
            {SAMPLES.map(s => <button key={s.id} type="button" className="linkish small" onClick={() => void openSample(s.id)}>{s.name}</button>)}
          </div>
        </>
      )}
    </section>
  )
}

function ProjectCard({ p }: { p: Project }) {
  const [renaming, setRenaming] = useState(false)
  const exams = [...p.exams].sort((a, b) => a.date.localeCompare(b.date))
  const last = exams.at(-1)
  const flagged = last ? last.snapshot.items.filter(i => i.flags.some(f => f === 'miskey' || f === 'negative' || f === 'ambiguous')).length : 0
  return (
    <article className="project-card">
      <div className="row between gap-sm">
        {renaming ? (
          <form onSubmit={e => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get('n')).trim(); if (v) void saveProject({ ...p, name: v }); setRenaming(false) }}>
            <input name="n" defaultValue={p.name} autoFocus aria-label="Course name" onBlur={e => e.currentTarget.form?.requestSubmit()} />
          </form>
        ) : <h3><Link href={`/app/p/${p.id}`}>{p.name}</Link></h3>}
        {p.sampleId && <SyntheticBadge />}
      </div>
      <dl className="mini-stats">
        <div><dt>Sittings</dt><dd>{p.exams.length}</dd></div>
        <div><dt>Latest alpha</dt><dd>{last ? f2(last.snapshot.alpha) : '—'}</dd></div>
        <div><dt>Needs review</dt><dd>{last ? (flagged ? <span className="chip critical">{flagged} items</span> : <span className="chip good">None</span>) : '—'}</dd></div>
      </dl>
      {exams.length > 0 && (
        <div className="row between gap-sm small muted">
          <span>{last!.title} · {last!.term}</span>
          <span title="Reliability per sitting"><Spark values={exams.map(e => e.snapshot.alpha)} lo={0.4} hi={1} w={90} h={24} /></span>
        </div>
      )}
      <div className="row between">
        <span className="muted small">{last ? `Last sitting ${fmtDate(last.date)}` : 'No exams yet'}</span>
        <div className="row gap-sm">
          <button type="button" className="btn ghost sm" onClick={() => setRenaming(true)}>Rename</button>
          <button type="button" className="btn danger-ghost sm" onClick={async () => {
            if (!(await ask(`Delete “${p.name}”?`, 'Removes the course, its exams and student rows from this device (and its statistics from the cloud, if you are signed in). You can undo for a few seconds.', 'Delete'))) return
            const undo = await deleteProject(p.id)
            toast(`Deleted ${p.name}`, { undo: () => void undo() })
          }}>Delete</button>
        </div>
      </div>
    </article>
  )
}

import { DEFAULT_BANDS, DEFAULT_THRESHOLDS, type Band } from './engine/types.ts'
import { deleteProject, getProjects, saveProject, setPrefs, usePrefs, type Prefs } from './store.ts'
import { exportAll, useSync } from './sync.ts'
import { ask, download, Link, setTheme, toast, useDark } from './ui.tsx'

export default function Settings() {
  const p = usePrefs()
  const dark = useDark()
  const sync = useSync()
  const save = (patch: Partial<Prefs>, msg = 'Saved') => { setPrefs(patch); toast(msg, { tone: 'ok', ttl: 1500 }) }
  const setBand = (i: number, b: Partial<Band>) => save({ bands: p.bands.map((x, j) => (j === i ? { ...x, ...b } : x)) })
  const th = p.thresholds
  const clamp = (v: string, lo: number, hi: number, d: number) => { const n = Number(v); return isNaN(n) ? d : Math.min(hi, Math.max(lo, n)) }

  return (
    <section className="page narrow settings">
      <div className="eyebrow">Settings</div>
      <h1>Settings</h1>

      <div className="panel" id="privacy">
        <div className="panel-head"><h2>Student privacy</h2>{sync.user ? <span className="chip neutral">Signed in as {sync.user.email}</span> : <span className="chip good">Signed out: nothing syncs</span>}</div>
        <label className="toggle">
          <input type="checkbox" checked={p.dropNames} onChange={e => save({ dropNames: e.target.checked })} />
          <span><b>Drop student names at import by default</b><br /><span className="muted small">Pseudonyms and LMS ids are kept so grade files still work. You can still choose per import.</span></span>
        </label>
        <hr />
        <label className="toggle">
          <input type="checkbox" checked={p.showNames} onChange={e => save({ showNames: e.target.checked })} />
          <span><b>Show names in regrade tables</b><br /><span className="muted small">Off by default, so a shared screen shows pseudonyms only. Names that were dropped cannot come back.</span></span>
        </label>
        <hr />
        <div className="local-list">
          <div>
            <h3>Always stays on this device</h3>
            <ul>
              <li>The files you import</li>
              <li>Student names, LMS ids, pseudonyms and every score</li>
              <li>Grade import files and class summaries</li>
              <li>Everything, if you never sign in</li>
            </ul>
          </div>
          <div>
            <h3>Syncs when you sign in</h3>
            <ul>
              <li>Course and exam names, terms and dates</li>
              <li>Item text, options and answer keys</li>
              <li>Regrade decisions and grade bands</li>
              <li>Per-item and per-exam statistics</li>
            </ul>
          </div>
        </div>
        <p className="muted small" style={{ marginTop: 12 }}><Link href="/docs#privacy">More on data handling</Link>.</p>
      </div>

      <div className="panel" id="bands">
        <div className="panel-head"><h2>Grade bands</h2><button type="button" className="btn ghost sm" onClick={() => save({ bands: DEFAULT_BANDS }, 'Bands reset')}>Reset</button></div>
        <p className="muted small">Used for regrade impact on new courses. Minimum percent for each band.</p>
        <div className="form-grid">
          {p.bands.map((b, i) => (
            <div key={i} className="row gap-sm">
              <label className="field" style={{ flex: 1 }}><span>Band</span><input defaultValue={b.label} onBlur={e => e.target.value.trim() && setBand(i, { label: e.target.value.trim() })} /></label>
              <label className="field" style={{ flex: 1 }}><span>From %</span><input type="number" min={0} max={100} defaultValue={b.min} onBlur={e => setBand(i, { min: clamp(e.target.value, 0, 100, b.min) })} /></label>
            </div>
          ))}
        </div>
        <div className="row gap wrap" style={{ marginTop: 12 }}>
          <button type="button" className="btn ghost sm" onClick={() => save({ bands: [...p.bands, { label: 'New', min: 0 }] })}>Add band</button>
          {p.bands.length > 2 && <button type="button" className="btn ghost sm" onClick={() => save({ bands: p.bands.slice(0, -1) })}>Remove last</button>}
          <button type="button" className="btn ghost sm" onClick={async () => {
            const list = getProjects()
            for (const x of list) await saveProject({ ...x, bands: p.bands })
            toast(`Applied to ${list.length} course${list.length === 1 ? '' : 's'}`, { tone: 'ok' })
          }}>Apply to existing courses</button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Flag thresholds</h2><button type="button" className="btn ghost sm" onClick={() => save({ thresholds: DEFAULT_THRESHOLDS }, 'Thresholds reset')}>Reset</button></div>
        <div className="form-grid">
          <label className="field"><span>Too easy above p</span><input type="number" step="0.01" min={0.5} max={1} defaultValue={th.easy} onBlur={e => save({ thresholds: { ...th, easy: clamp(e.target.value, 0.5, 1, 0.9) } })} /></label>
          <label className="field"><span>Too hard below p</span><input type="number" step="0.01" min={0} max={0.6} defaultValue={th.hard} onBlur={e => save({ thresholds: { ...th, hard: clamp(e.target.value, 0, 0.6, 0.3) } })} /></label>
          <label className="field"><span>Weak discrimination below D</span><input type="number" step="0.01" min={0} max={0.5} defaultValue={th.weakD} onBlur={e => save({ thresholds: { ...th, weakD: clamp(e.target.value, 0, 0.5, 0.2) } })} /></label>
          <label className="field"><span>Non-functioning distractor below</span><input type="number" step="0.01" min={0} max={0.2} defaultValue={th.nfd} onBlur={e => save({ thresholds: { ...th, nfd: clamp(e.target.value, 0, 0.2, 0.05) } })} /><small>Share of students choosing it.</small></label>
          <label className="field"><span>Grade files: points out of</span><input type="number" min={1} defaultValue={p.outOf} onBlur={e => save({ outOf: clamp(e.target.value, 1, 10000, 100) })} /><small>Default for new imports.</small></label>
        </div>
      </div>

      <div className="panel">
        <h2>Appearance</h2>
        <div className="seg-control" role="radiogroup" aria-label="Theme">
          <button type="button" role="radio" aria-checked={!dark} className={!dark ? 'on' : ''} onClick={() => setTheme('light')}>Light</button>
          <button type="button" role="radio" aria-checked={dark} className={dark ? 'on' : ''} onClick={() => setTheme('dark')}>Dark</button>
        </div>
      </div>

      <div className="panel">
        <h2>Your data</h2>
        <p>Courses live in this browser (IndexedDB). {sync.user ? <>Signed in as <b>{sync.user.email}</b>.</> : 'Sign in from the account menu to see your item banks on another device. It is optional.'}</p>
        <div className="row gap wrap">
          <button type="button" className="btn ghost" onClick={async () => download(`item-analysis-export-${new Date().toISOString().slice(0, 10)}.json`, await exportAll())}>Export all my data (JSON)</button>
          <button type="button" className="btn danger-ghost" onClick={async () => {
            const list = getProjects()
            if (!list.length) { toast('Nothing to delete'); return }
            if (!(await ask('Delete every course?', `Removes ${list.length} course${list.length > 1 ? 's' : ''} and their student rows from this browser${sync.user ? ' and from your cloud account' : ''}. You can undo for a few seconds.`, 'Delete everything'))) return
            const undos = await Promise.all(list.map(x => deleteProject(x.id)))
            toast(`Deleted ${list.length} courses`, { undo: () => { for (const u of undos) void u() } })
          }}>Delete all courses</button>
        </div>
      </div>

      <div className="panel">
        <h2>Keyboard shortcuts</h2>
        <dl className="shortcuts">
          <div><dt><kbd>1</kbd>&ndash;<kbd>5</kbd></dt><dd>Switch tabs in a course</dd></div>
          <div><dt><kbd>[</kbd> <kbd>]</kbd></dt><dd>Previous / next exam sitting</dd></div>
          <div><dt><kbd>P</kbd></dt><dd>Printable exam quality report</dd></div>
          <div><dt><kbd>Esc</kbd></dt><dd>Close the item panel</dd></div>
          <div><dt><kbd>&#8984;</kbd>/<kbd>Ctrl</kbd> <kbd>Z</kbd></dt><dd>Undo the last regrade or delete</dd></div>
        </dl>
      </div>
    </section>
  )
}

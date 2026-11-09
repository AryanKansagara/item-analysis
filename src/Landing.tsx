import { useMemo, useState } from 'react'
import { DistractorChart, Histogram, ItemMap } from './Charts.tsx'
import { SAMPLES } from './engine/sample.ts'
import { analyze, FLAG_SEVERITY, FLAG_TEXT, impact, rescore, severity } from './engine/stats.ts'
import { DEFAULT_BANDS, type Adjustment } from './engine/types.ts'
import { f2, Link, pct, SyntheticBadge } from './ui.tsx'

const demo = SAMPLES[0].exams()[1]

function HeroDemo() {
  const base = useMemo(() => analyze(demo.exam), [])
  const first = base.items.find(i => i.flags.includes('miskey')) ?? base.items[0]
  const [sel, setSel] = useState(first.id)
  const [adj, setAdj] = useState<Adjustment[]>([])
  const after = useMemo(() => rescore(demo.exam, adj), [adj])
  const a = useMemo(() => (adj.length ? analyze(after) : base), [after, adj, base])
  const im = useMemo(() => impact(demo.exam, after, DEFAULT_BANDS), [after])
  const s = a.items.find(i => i.id === sel) ?? a.items[0]
  const raw = base.items.find(i => i.id === sel)!
  const item = demo.exam.items.find(i => i.id === sel)!
  const applied = adj.find(x => x.itemId === sel)
  const flagged = base.items.filter(i => severity(i) >= 1).length

  return (
    <div className="demo" aria-label="Live item analysis of a synthetic midterm">
      <div className="demo-bar">
        <span><b>BIO 110 · Midterm 1</b> <span className="muted">Winter 2026 · 180 students · 40 items</span></span>
        <span className="row gap-sm"><SyntheticBadge /><span className="chip critical">{flagged} item{flagged === 1 ? "" : "s"} to review</span></span>
      </div>
      <div className="demo-body">
        <div>
          <ItemMap items={a.items} selected={sel} onSelect={setSel} compact />
          <p className="tiny muted" style={{ margin: '4px 0 0' }}>Every dot is a question, computed live in your browser. Click one.</p>
        </div>
        <div>
          <div className="row between gap-sm" style={{ marginBottom: 6 }}>
            <strong style={{ fontSize: '1.1rem' }}>{s.label}</strong>
            <div className="flags">{s.flags.slice(0, 3).map(f => <span key={f} className={`flag f${FLAG_SEVERITY[f]}`}>{FLAG_TEXT[f]}</span>)}{!s.flags.length && <span className="flag f0">No flags</span>}</div>
          </div>
          <p className="small muted" style={{ margin: '0 0 8px' }}>{item.stem} Keyed: <b>{item.key?.join(', ')}</b>. p {f2(s.p)} · r {f2(s.rCorrected)}</p>
          {s.options.length > 0 && <DistractorChart options={s.options} suspect={raw.suspect} />}
          {raw.suspect && (
            <button type="button" className={`btn ${applied ? 'ghost' : 'primary'} sm block`} style={{ marginTop: 10 }} onClick={() => setAdj(applied ? adj.filter(x => x !== applied) : [...adj.filter(x => x.itemId !== sel), { itemId: sel, kind: 'accept', accept: [raw.suspect!] }])}>
              {applied ? 'Undo regrade' : `Accept ${[...(item.key ?? []), raw.suspect].sort().join(' and ')} and re-score the class`}
            </button>
          )}
        </div>
      </div>
      <div className="demo-foot">
        <div className="stat-row" aria-live="polite">
          <div><span>Alpha</span><b className={adj.length ? 'up' : ''}>{f2(a.test.alpha)}</b></div>
          <div><span>Class mean</span><b className={adj.length ? 'up' : ''}>{im.meanAfter.toFixed(1)}%</b></div>
          <div><span>Students raised</span><b className={im.raised ? 'up' : ''}>{im.raised}</b></div>
          <div><span>Grade changes</span><b className={im.changedBand ? 'up' : ''}>{im.changedBand}</b></div>
        </div>
        <div style={{ maxWidth: 360, justifySelf: 'end', width: '100%' }}><Histogram bins={a.test.histogram} before={adj.length ? base.test.histogram : undefined} height={92} /></div>
      </div>
    </div>
  )
}

export function Landing() {
  return (
    <>
      <section className="hero">
        <div className="hero-inner">
          <div>
            <div className="eyebrow">Item analysis for Brightspace, Canvas and Moodle quizzes</div>
            <h1>Find the broken questions <em>before grades go out.</em></h1>
            <p className="hero-lede">Drop in a quiz export. Item Analysis computes difficulty, discrimination, KR-20 and alpha, reads every distractor, flags the miskey, simulates the regrade, and writes the grade file you import back.</p>
            <div className="hero-cta">
              <Link href="/app?sample=bio110" className="btn primary">Open the sample midterm</Link>
              <Link href="/app" className="btn ghost">Import your quiz</Link>
            </div>
            <p className="hero-note">Free. Runs in your browser. Student names never leave your device.</p>
          </div>
          <HeroDemo />
        </div>
      </section>

      <section className="section">
        <div className="eyebrow">What instructors told us</div>
        <h2 className="big">The numbers exist. Getting to them, and acting on them, is the hard part.</h2>
        <div className="quotes">
          <blockquote className="quote"><p>Instructors who do item analysis lean on two numbers: difficulty, and discrimination from the upper versus lower group or a point-biserial. Sharing results with a class means medians and quartiles, never ranks.</p><small>Paraphrased from faculty discussions on r/Professors</small></blockquote>
          <blockquote className="quote"><p>Grade settings are confusing for nearly everyone, starting with whether an ungraded item counts as a zero. A regrade that lands in the wrong column causes more harm than the bad question.</p><small>Paraphrased from r/instructionaldesign</small></blockquote>
          <blockquote className="quote"><p>Brightspace has a real learning curve, but the weighted gradebook and Intelligent Agents earn their keep once they are set up.</p><small>Paraphrased from an r/Professors thread on Brightspace</small></blockquote>
        </div>
      </section>

      <section className="section">
        <div className="eyebrow">From export to fixed grades</div>
        <h2 className="big">Four steps, one sitting.</h2>
        <ol className="steps">
          <li><h3>Import</h3><p>Brightspace attempt details or a Grades export, Canvas Student Analysis, Moodle responses, or any student-by-item CSV. Formats are detected; every problem is listed with its line number.</p></li>
          <li><h3>Diagnose</h3><p>Difficulty, upper-lower 27% index, point-biserial and corrected item-total r. KR-20, KR-21, alpha and alpha-if-deleted. Distractor curves by score group.</p></li>
          <li><h3>Regrade</h3><p>Drop an item, accept two answers, or give full credit, and watch each student's score and letter grade change before you commit.</p></li>
          <li><h3>Apply</h3><p>Download a Brightspace or Canvas grade import, a class summary for students, and a printable exam quality report for your chair.</p></li>
        </ol>
        <div className="formats">
          {['Brightspace Question Details', 'Brightspace Grades CSV', 'Canvas Student Analysis', 'Canvas Item Analysis', 'Moodle responses', 'Generic CSV + answer key'].map(f => <span key={f} className="badge">{f}</span>)}
        </div>
      </section>

      <section className="section">
        <div className="eyebrow">What it catches</div>
        <h2 className="big">Every flag comes with its evidence and a fix.</h2>
        <div className="cards">
          <article className="card"><span className="card-tag">!</span><h3>Likely miskeys</h3><p>A distractor that your strongest students choose more often than the key, with a positive correlation to the rest of the test. One click accepts it.</p></article>
          <article className="card"><span className="card-tag">≈</span><h3>Ambiguous items</h3><p>Top scorers split between two answers. Accept both for this sitting, then reword before reuse.</p></article>
          <article className="card"><span className="card-tag">−</span><h3>Negative discrimination</h3><p>Weaker students outscore stronger ones. Alpha-if-deleted shows how much the item costs the test.</p></article>
          <article className="card"><span className="card-tag">∅</span><h3>Dead distractors</h3><p>Options chosen by under 5% of students. They make guessing easier and the item less informative.</p></article>
          <article className="card"><span className="card-tag">↕</span><h3>Too easy, too hard</h3><p>p above 0.90 or below 0.30, with thresholds you can change. Easy items are fine on purpose; you decide.</p></article>
          <article className="card"><span className="card-tag">↻</span><h3>Drift across terms</h3><p>The same question keyed across sittings shows its p and discrimination per term, so a key edited by mistake stands out.</p></article>
        </div>
      </section>

      <section className="section">
        <div className="privacy-band">
          <div>
            <div className="eyebrow on-dark">Student privacy</div>
            <h2>Names are hashed on import. Scores never sync.</h2>
            <p>Each student becomes a short pseudonym like S-4K2QZ1, salted per course. You can drop names completely; the LMS id stays on your device only so the regrade file can be imported back.</p>
          </div>
          <ul>
            <li>Parsing and statistics run in your browser.</li>
            <li>No account needed. Signing in syncs courses, items, keys, regrades and statistics.</li>
            <li>Student names, ids and scores are never sent anywhere.</li>
            <li>Export or delete everything from the account menu.</li>
          </ul>
        </div>
      </section>

      <section className="cta-band">
        <h2>Check the midterm before you post it.</h2>
        <p className="muted">Two synthetic courses are ready to explore: a 180-student biology midterm with a miskey, and a partial-credit stats quiz.</p>
        <div className="row gap center-x wrap" style={{ marginTop: 20 }}>
          <Link href="/app?sample=bio110" className="btn primary">Open BIO 110</Link>
          <Link href="/app?sample=stat201" className="btn ghost">Open STAT 201</Link>
          <Link href="/docs" className="btn ghost">How to export from your LMS</Link>
        </div>
        <p className="tiny muted" style={{ marginTop: 16 }}>{pct(0.27)} upper and lower groups · population variances · first attempts only</p>
      </section>
    </>
  )
}

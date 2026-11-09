import type { ItemStat, OptionStat } from './engine/stats.ts'
import { severity } from './engine/stats.ts'

const W = 520, H = 340, L = 40, R = 14, T = 14, B = 36
const Y0 = -0.4, Y1 = 0.8

/** Difficulty (x) against corrected item-total correlation (y). */
export function ItemMap({ items, selected, onSelect, compact }: { items: ItemStat[]; selected?: string; onSelect(id: string): void; compact?: boolean }) {
  const x = (p: number) => L + p * (W - L - R)
  const y = (r: number) => T + ((Y1 - Math.max(Y0, Math.min(Y1, r))) / (Y1 - Y0)) * (H - T - B)
  const rad = compact ? 5.5 : 6.5
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Item map: difficulty against discrimination. Red points are flagged items.">
      <rect className="zone" x={L} y={y(0)} width={W - L - R} height={y(Y0) - y(0)} />
      <rect className="zone-ok" x={x(0.3)} y={y(Y1)} width={x(0.9) - x(0.3)} height={y(0.2) - y(Y1)} />
      <text className="zone-label" x={x(0.32)} y={y(Y1) + 14}>Healthy items</text>
      <text className="zone-label" x={L + 6} y={y(Y0) - 6}>Negative discrimination</text>
      {[0, 0.2, 0.4, 0.6, 0.8, 1].map(t => <g key={t}><line className="grid" x1={x(t)} x2={x(t)} y1={T} y2={H - B} /><text x={x(t)} y={H - B + 16} textAnchor="middle">{t.toFixed(1)}</text></g>)}
      {[-0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8].map(t => <g key={t}><line className={t === 0 ? 'axis' : 'grid'} x1={L} x2={W - R} y1={y(t)} y2={y(t)} /><text x={L - 6} y={y(t) + 3.5} textAnchor="end">{t.toFixed(1)}</text></g>)}
      <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle">Difficulty p (share correct) →</text>
      <text transform={`translate(11 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle">Discrimination r →</text>
      {items.map(s => {
        const sev = severity(s)
        const cx = x(s.p), cy = y(s.rCorrected ?? 0)
        return (
          <g key={s.id}>
            {sev === 2 && <circle className="dot-ring" cx={cx} cy={cy} r={rad} style={{ cx, cy } as React.CSSProperties} />}
            <circle
              className={`dot s${sev}${selected === s.id ? ' sel' : ''}`} r={selected === s.id ? rad + 3 : rad} style={{ cx, cy } as React.CSSProperties} cx={cx} cy={cy}
              tabIndex={0} role="button" aria-label={`${s.label}: p ${s.p.toFixed(2)}, r ${(s.rCorrected ?? 0).toFixed(2)}${s.flags.length ? ', ' + s.flags.join(', ') : ''}`}
              onClick={() => onSelect(s.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(s.id) } }}
            ><title>{`${s.label}  p=${s.p.toFixed(2)}  r=${(s.rCorrected ?? 0).toFixed(2)}`}</title></circle>
            {(sev === 2 || selected === s.id) && <text x={cx + 10} y={cy + 4} style={{ fill: 'var(--ink)', fontWeight: 700 }}>{s.label}</text>}
          </g>
        )
      })}
    </svg>
  )
}

/** Share choosing each option across five score groups, lowest scorers on the left. */
export function DistractorChart({ options, suspect }: { options: OptionStat[]; suspect?: string }) {
  const w = 420, h = 220, l = 34, r = 40, t = 10, b = 30
  const x = (i: number) => l + (i / 4) * (w - l - r)
  const y = (v: number) => t + (1 - v) * (h - t - b)
  const color = (o: OptionStat) => (o.isKey ? 'var(--good)' : o.option === suspect ? 'var(--dot-bad)' : 'var(--ink-4)')
  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Distractor curves: share choosing each option by score group">
        {[0, 0.25, 0.5, 0.75, 1].map(v => <g key={v}><line className="grid" x1={l} x2={w - r} y1={y(v)} y2={y(v)} /><text x={l - 6} y={y(v) + 3.5} textAnchor="end">{Math.round(v * 100)}%</text></g>)}
        {['Lowest', '2nd', 'Middle', '4th', 'Top'].map((g, i) => <text key={g} x={x(i)} y={h - 10} textAnchor="middle">{g}</text>)}
        {options.map(o => (
          <g key={o.option}>
            <polyline points={o.byGroup.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={color(o)} strokeWidth={o.isKey || o.option === suspect ? 3 : 1.6} strokeDasharray={o.all < 0.05 && !o.isKey ? '3 4' : undefined} style={{ transition: 'all .6s var(--ease)' }} />
            {o.byGroup.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={o.isKey || o.option === suspect ? 3.5 : 2.5} fill={color(o)} style={{ transition: 'all .6s var(--ease)' }} />)}
            <text x={w - r + 8} y={y(o.byGroup[4]) + 4} style={{ fill: color(o), fontWeight: 700, fontSize: 12 }}>{o.option}{o.isKey ? ' ✓' : ''}</text>
          </g>
        ))}
      </svg>
      <figcaption className="legend">
        <span><i style={{ background: 'var(--good)' }} />Keyed answer</span>
        {suspect && <span><i style={{ background: 'var(--dot-bad)' }} />Suspect distractor</span>}
        <span><i style={{ background: 'var(--ink-4)' }} />Other options (dashed: chosen by under 5%)</span>
      </figcaption>
    </figure>
  )
}

/** Percent-score histogram; the ghost bars are the scores before regrading. */
export function Histogram({ bins, before, height = 150 }: { bins: number[]; before?: number[]; height?: number }) {
  const w = 420, h = height, l = 6, b = 22, t = 8
  const max = Math.max(1, ...bins, ...(before ?? []))
  const bw = (w - l * 2) / 10
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Score distribution: ${bins.join(', ')} students per 10-point band`}>
      {bins.map((c, i) => {
        const bh = (c / max) * (h - b - t), oh = before ? (before[i] / max) * (h - b - t) : 0
        return (
          <g key={i}>
            {before && <rect className="bar hist-old" x={l + i * bw + 3} width={bw - 6} y={h - b - oh} height={oh} rx={3} />}
            <rect className="bar hist" x={l + i * bw + (before ? 9 : 3)} width={bw - (before ? 12 : 6)} y={h - b - bh} height={bh} rx={3}><title>{`${i * 10}-${i === 9 ? 100 : i * 10 + 9}%: ${c}`}</title></rect>
            <text x={l + i * bw + bw / 2} y={h - 6} textAnchor="middle">{i * 10}</text>
          </g>
        )
      })}
    </svg>
  )
}

export function Spark({ values, bad, w = 120, h = 30, lo = 0, hi = 1 }: { values: (number | null)[]; bad?: boolean[]; w?: number; h?: number; lo?: number; hi?: number }) {
  const pts = values.map((v, i) => (v === null ? null : [values.length === 1 ? w / 2 : 4 + (i / (values.length - 1)) * (w - 8), 3 + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (h - 6)]))
  const d = pts.filter(Boolean).map((p, i) => `${i ? 'L' : 'M'}${p![0]},${p![1]}`).join('')
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d} />
      {pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={2.6} className={bad?.[i] ? 'bad' : ''} />)}
    </svg>
  )
}

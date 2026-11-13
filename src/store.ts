import { useSyncExternalStore } from 'react'
import type { ExamSnapshot } from './engine/actions.ts'
import { stemKey, type Format } from './engine/importer.ts'
import { DEFAULT_BANDS, DEFAULT_THRESHOLDS, type Adjustment, type Attempt, type Band, type Item, type Thresholds } from './engine/types.ts'

/** One exam sitting. Items, keys, regrades and statistics; student rows live in IndexedDB under the exam id. */
export interface ExamMeta {
  id: string
  title: string
  term: string
  date: string
  format: Format
  fileName?: string
  importedAt: number
  items: Item[]
  adjustments: Adjustment[]
  /** Statistics as of the last change, also used by the item bank and sync. */
  snapshot: ExamSnapshot
  gradeItem?: string
  outOf?: number
  namesDropped?: boolean
  summaryOnly?: boolean
  note?: string
}

export interface Project {
  id: string
  name: string
  course: string
  createdAt: number
  updatedAt: number
  /** Salt for this course's pseudonyms, so the same student maps to the same id across sittings. */
  salt: string
  exams: ExamMeta[]
  bands: Band[]
  sampleId?: string
}

// ---------- Tiny IndexedDB wrapper (falls back to memory in private modes) ----------

const DB = 'item-analysis'
let dbp: Promise<IDBDatabase | null> | null = null
function db(): Promise<IDBDatabase | null> {
  return dbp ??= new Promise(res => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore('projects', { keyPath: 'id' })
        req.result.createObjectStore('data')
      }
      req.onsuccess = () => res(req.result)
      req.onerror = () => res(null)
    } catch { res(null) }
  })
}
const mem = { projects: new Map<string, unknown>(), data: new Map<string, unknown>() }

async function tx<T>(store: 'projects' | 'data', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db()
  if (!d) throw new Error('no-idb')
  return new Promise((res, rej) => {
    const r = fn(d.transaction(store, mode).objectStore(store))
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })
}
async function idbGetAll<T>(store: 'projects'): Promise<T[]> {
  try { return await tx(store, 'readonly', s => s.getAll()) as T[] } catch { return [...mem[store].values()] as T[] }
}
async function idbGet<T>(store: 'projects' | 'data', key: string): Promise<T | undefined> {
  try { return await tx(store, 'readonly', s => s.get(key)) as T | undefined } catch { return mem[store].get(key) as T | undefined }
}
async function idbPut(store: 'projects' | 'data', value: unknown, key?: string) {
  try { await tx(store, 'readwrite', s => key === undefined ? s.put(value) : s.put(value, key)) } catch { mem[store].set(key ?? (value as { id: string }).id, value) }
}
async function idbDel(store: 'projects' | 'data', key: string) {
  try { await tx(store, 'readwrite', s => s.delete(key)) } catch { mem[store].delete(key) }
}

// ---------- In-memory project list with subscribers ----------

let projects: Project[] = []
let loaded = false
const subs = new Set<() => void>()
const emit = () => { projects = [...projects]; subs.forEach(f => f()) }
const changeHooks = new Set<(p: Project) => void>()

export const onProjectChange = (f: (p: Project) => void) => { changeHooks.add(f); return () => changeHooks.delete(f) }

/** Version 1 keyed Canvas Item Analysis questions differently from student-level imports; rekey so the bank links them. */
const migrate = (p: Project): Project => p.exams.some(e => e.summaryOnly)
  ? { ...p, exams: p.exams.map(e => (e.summaryOnly ? { ...e, snapshot: { ...e.snapshot, items: e.snapshot.items.map(i => (i.stem ? { ...i, bankKey: stemKey(i.stem) } : i)) } } : e)) }
  : p

export async function loadProjects() {
  projects = (await idbGetAll<Project>('projects')).map(migrate).sort((a, b) => b.updatedAt - a.updatedAt)
  loaded = true
  emit()
}

export function useProjects() {
  return useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => loaded ? projects : null)
}

export const getProjects = () => projects
export const getProject = (id: string) => projects.find(p => p.id === id)

export async function saveProject(p: Project, opts: { touch?: boolean; silent?: boolean } = {}) {
  const next = opts.touch === false ? p : { ...p, updatedAt: Date.now() }
  await idbPut('projects', next)
  const i = projects.findIndex(x => x.id === p.id)
  if (i >= 0) projects[i] = next
  else projects.unshift(next)
  projects.sort((a, b) => b.updatedAt - a.updatedAt)
  emit()
  if (!opts.silent) changeHooks.forEach(f => f(next))
  return next
}

/** Deletes locally; returns an undo function that restores the project and its data. */
export async function deleteProject(id: string): Promise<() => Promise<void>> {
  const p = getProject(id)
  const data = p ? await Promise.all(p.exams.map(e => getAttempts(e.id))) : []
  projects = projects.filter(x => x.id !== id)
  emit()
  await idbDel('projects', id)
  for (const e of p?.exams ?? []) await idbDel('data', e.id)
  addTombstone(id)
  return async () => {
    if (!p) return
    removeTombstone(id)
    for (const [i, e] of p.exams.entries()) if (data[i]) await putAttempts(e.id, data[i]!)
    await saveProject(p)
  }
}

/** Student rows for one exam sitting. Never synced. */
export const getAttempts = (examId: string) => idbGet<Attempt[]>('data', examId)
export const putAttempts = (examId: string, a: Attempt[]) => idbPut('data', a, examId)
export const delAttempts = (examId: string) => idbDel('data', examId)

export const uuid = () => crypto.randomUUID()

// Tombstones keep a project deleted offline from coming back on the next sync.
const TOMB = 'item-analysis.tombstones'
export const tombstones = (): string[] => { try { return JSON.parse(localStorage.getItem(TOMB) ?? '[]') } catch { return [] } }
const addTombstone = (id: string) => localStorage.setItem(TOMB, JSON.stringify([...new Set([...tombstones(), id])]))
const removeTombstone = (id: string) => localStorage.setItem(TOMB, JSON.stringify(tombstones().filter(x => x !== id)))
export const clearTombstones = (ids: string[]) => localStorage.setItem(TOMB, JSON.stringify(tombstones().filter(x => !ids.includes(x))))

// ---------- App preferences (settings page) ----------

export interface Prefs {
  /** Drop student names right after import (pseudonyms and LMS ids are kept for grade files). */
  dropNames: boolean
  /** Show names in tables when they are on this device. Off: pseudonyms only. */
  showNames: boolean
  bands: Band[]
  thresholds: Thresholds
  /** The point scale grade files are written on by default. */
  outOf: number
}
const PREF_KEY = 'item-analysis.prefs'
const DEFAULT_PREFS: Prefs = { dropNames: false, showNames: false, bands: DEFAULT_BANDS, thresholds: DEFAULT_THRESHOLDS, outOf: 100 }
let prefs: Prefs | null = null
const prefSubs = new Set<() => void>()
export function getPrefs(): Prefs {
  if (prefs) return prefs
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}')
    prefs = { ...DEFAULT_PREFS, ...raw, thresholds: { ...DEFAULT_THRESHOLDS, ...raw.thresholds } }
  } catch { prefs = DEFAULT_PREFS }
  return prefs!
}
export function setPrefs(p: Partial<Prefs>) {
  prefs = { ...getPrefs(), ...p }
  localStorage.setItem(PREF_KEY, JSON.stringify(prefs))
  prefSubs.forEach(f => f())
}
export const usePrefs = () => useSyncExternalStore(f => { prefSubs.add(f); return () => prefSubs.delete(f) }, getPrefs)

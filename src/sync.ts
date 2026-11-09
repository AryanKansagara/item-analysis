// Optional cloud sync. Local-first: everything works signed out; signing in merges courses by id, last write wins.
// Only course settings, items, keys, regrade decisions and statistics sync. Student rows (names, LMS ids,
// pseudonyms and scores) never leave the device.
import { useSyncExternalStore } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clearTombstones, getAttempts, getProjects, loadProjects, onProjectChange, saveProject, tombstones, type Project } from './store.ts'

export const APP_ID = 'item-analysis'
/** Course payloads above this are not pushed (the cloud row limit is about 3.5 MB). */
export const SYNC_LIMIT = 3_000_000

const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
export const cloudConfigured = !!(URL_ && KEY)

export type SyncStatus = 'local' | 'syncing' | 'synced' | 'offline' | 'error'
interface State { user: { id: string; email: string } | null; status: SyncStatus; error: string | null; lastSynced: number | null; ready: boolean }
let state: State = { user: null, status: 'local', error: null, lastSynced: null, ready: false }
const subs = new Set<() => void>()
const set = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach(f => f()) }
export const useSync = () => useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => state)
export const getSyncState = () => state

let clientP: Promise<SupabaseClient> | null = null
function client(): Promise<SupabaseClient> {
  if (!cloudConfigured) return Promise.reject(new Error('Cloud sync is not configured for this build.'))
  return clientP ??= import('@supabase/supabase-js').then(({ createClient }) => {
    const c = createClient(URL_!, KEY!, { auth: { persistSession: true, autoRefreshToken: true } })
    c.auth.onAuthStateChange((_e, session) => {
      const u = session?.user
      set({ user: u ? { id: u.id, email: u.email ?? '' } : null, status: u ? state.status === 'local' ? 'synced' : state.status : 'local' })
    })
    return c
  })
}

const hasStoredSession = () => Object.keys(localStorage).some(k => k.startsWith('sb-') && k.endsWith('-auth-token'))

/** Called once at boot. Only loads the Supabase client if a session is already stored. */
export async function initSync() {
  onProjectChange(() => schedule())
  addEventListener('online', () => { if (state.user) void syncNow() })
  addEventListener('offline', () => { if (state.user) set({ status: 'offline' }) })
  if (!hasStoredSession()) { set({ ready: true }); return }
  try {
    const c = await client()
    const { data } = await c.auth.getSession()
    const u = data.session?.user
    set({ user: u ? { id: u.id, email: u.email ?? '' } : null, ready: true })
    if (u) void syncNow()
  } catch (e) {
    set({ ready: true, status: 'error', error: msg(e) })
  }
}

const msg = (e: unknown) => {
  const m = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  return /fetch|network|load failed/i.test(m) ? 'Could not reach the sync server. Your work is safe on this device.' : m
}

export async function signUp(email: string, password: string) {
  const c = await client()
  const { data, error } = await c.auth.signUp({ email, password })
  if (error) throw new Error(error.message)
  if (!data.session) { await signIn(email, password); return }
  set({ user: { id: data.user!.id, email } })
  await syncNow()
}

export async function signIn(email: string, password: string) {
  const c = await client()
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
  set({ user: { id: data.user.id, email: data.user.email ?? email } })
  await syncNow()
}

export async function signOut() {
  const c = await client()
  await c.auth.signOut()
  set({ user: null, status: 'local', lastSynced: null, error: null })
}

let timer: ReturnType<typeof setTimeout> | undefined
function schedule() {
  if (!state.user) return
  clearTimeout(timer)
  timer = setTimeout(() => void syncNow(), 1500)
}

interface CloudRow { id: string; name: string; data: { project: Project }; updated_at: string }

let running: Promise<void> | null = null
export function syncNow(): Promise<void> {
  if (!state.user) return Promise.resolve()
  if (running) return running.then(() => syncNow())
  running = doSync().finally(() => { running = null })
  return running
}

async function doSync() {
  if (!navigator.onLine) { set({ status: 'offline' }); return }
  set({ status: 'syncing', error: null })
  try {
    const c = await client()
    const dead = tombstones()
    if (dead.length) {
      const { error } = await c.from('projects').delete().in('id', dead).eq('app', APP_ID)
      if (error) throw error
      clearTombstones(dead)
    }
    const { data: rows, error } = await c.from('projects').select('id,name,data,updated_at').eq('app', APP_ID)
    if (error) throw error
    const cloud = new Map((rows as CloudRow[]).map(r => [r.id, r]))
    const local = getProjects()
    const ids = [...new Set([...cloud.keys(), ...local.map(p => p.id)])]
    let skipped = 0
    for (const id of ids) {
      const lp = local.find(p => p.id === id)
      const cp = cloud.get(id)
      const cloudTime = cp ? Date.parse(cp.updated_at) : 0
      if (lp && (!cp || lp.updatedAt > cloudTime)) {
        const project = cloudCopy(lp)
        if (JSON.stringify(project).length > SYNC_LIMIT) { skipped++; continue }
        const { error: e1 } = await c.from('projects').upsert({ id, app: APP_ID, name: lp.name, data: { project }, updated_at: new Date(lp.updatedAt).toISOString() })
        if (e1) throw e1
        // One version row per exam sitting: the dated statistics the item bank is built from.
        if (lp.exams.length) {
          const { error: e2 } = await c.from('project_versions').upsert(lp.exams.map(e => ({ id: e.id, project_id: id, label: `${e.term} · ${e.title}`, data: e.snapshot })))
          if (e2) throw e2
        }
        const gone = cp?.data.project.exams.filter(e => !lp.exams.some(x => x.id === e.id)).map(e => e.id) ?? []
        if (gone.length) await c.from('project_versions').delete().in('id', gone)
      } else if (cp && (!lp || cloudTime > lp.updatedAt)) {
        await saveProject({ ...cp.data.project, id, name: cp.name, updatedAt: cloudTime }, { touch: false, silent: true })
      }
    }
    set({ status: 'synced', lastSynced: Date.now(), error: skipped ? `${skipped} course${skipped > 1 ? 's are' : ' is'} too large to sync and stay on this device.` : null })
  } catch (e) {
    set({ status: navigator.onLine ? 'error' : 'offline', error: msg(e) })
  }
}

/** What leaves the device: no student rows. Item stems and keys are the instructor's own material. */
export const cloudCopy = (p: Project): Project => ({ ...p, exams: p.exams.map(e => ({ ...e, fileName: undefined })) })

/** Which exams of a course have student rows on this device. */
export async function localExamIds(p: Project) {
  const has = await Promise.all(p.exams.map(async e => !!(await getAttempts(e.id))))
  return new Set(p.exams.filter((_, i) => has[i]).map(e => e.id))
}

export async function deleteCloudData() {
  const c = await client()
  const { data: rows } = await c.from('projects').select('id').eq('app', APP_ID)
  const ids = (rows ?? []).map(r => r.id as string)
  if (ids.length) await c.from('project_versions').delete().in('project_id', ids)
  const { error } = await c.from('projects').delete().eq('app', APP_ID)
  if (error) throw new Error(error.message)
  set({ status: 'synced', lastSynced: Date.now() })
}

export async function deleteAccount() {
  const c = await client()
  const { error } = await c.rpc('delete_my_account')
  if (error) throw new Error(error.message)
  await c.auth.signOut()
  set({ user: null, status: 'local', lastSynced: null })
}

export async function exportAll(): Promise<Blob> {
  await loadProjects()
  const list = await Promise.all(getProjects().map(async p => ({ ...p, exams: await Promise.all(p.exams.map(async e => ({ ...e, attempts: await getAttempts(e.id) }))) })))
  return new Blob([JSON.stringify({ app: APP_ID, exportedAt: new Date().toISOString(), projects: list }, null, 1)], { type: 'application/json' })
}

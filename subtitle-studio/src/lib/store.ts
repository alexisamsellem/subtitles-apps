// État de l'application, hors React : abonnements fins par ligne pour que
// la frappe dans une réplique ne re-rende jamais les milliers d'autres.
// Persistance automatique dans localStorage (un projet actif).

import type { Cue } from './srt'
import { serializeSrt } from './srt'
import { applyWrappers, extractWrappers } from './tags'

export interface RowState {
  /** Texte cible tel qu'édité (les enveloppes de style sont gérées à part). */
  target: string
  wrapOpen: string
  wrapClose: string
  /** Modifié à la main par l'utilisateur. */
  edited: boolean
  /** À vérifier (alignement approximatif, traduction IA, ou marquage manuel). */
  review: boolean
  reviewNote: string
}

export interface ProjectData {
  version: 1
  fileName: string
  srcLang: string
  tgtLang: string
  cues: Cue[]
  rows: RowState[]
  updatedAt: number
}

export interface Stats {
  total: number
  translated: number
  empty: number
  edited: number
  review: number
}

const STORAGE_KEY = 'subtitle-studio:project:v1'

type Listener = () => void

class Store {
  project: ProjectData | null = null
  activeIndex = -1

  private globalVersion = 0
  private rowVersions: number[] = []
  private globalListeners = new Set<Listener>()
  private rowListeners = new Map<number, Set<Listener>>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private notifyTimer: ReturnType<typeof setTimeout> | null = null
  private statsCache: Stats | null = null

  // ---- abonnements ----

  subscribe = (fn: Listener) => {
    this.globalListeners.add(fn)
    return () => this.globalListeners.delete(fn)
  }
  getVersion = () => this.globalVersion

  subscribeRow(index: number, fn: Listener) {
    let set = this.rowListeners.get(index)
    if (!set) {
      set = new Set()
      this.rowListeners.set(index, set)
    }
    set.add(fn)
    return () => {
      set.delete(fn)
      if (set.size === 0) this.rowListeners.delete(index)
    }
  }
  getRowVersion = (index: number) => this.rowVersions[index] ?? 0

  private bumpRow(index: number) {
    this.rowVersions[index] = (this.rowVersions[index] ?? 0) + 1
    this.rowListeners.get(index)?.forEach((fn) => fn())
    this.statsCache = null
    this.scheduleGlobalNotify()
    this.scheduleSave()
  }

  private bumpGlobal() {
    this.globalVersion++
    this.statsCache = null
    this.globalListeners.forEach((fn) => fn())
    this.scheduleSave()
  }

  /** Les stats de l'en-tête se rafraîchissent en léger différé pendant la frappe. */
  private scheduleGlobalNotify() {
    if (this.notifyTimer) return
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null
      this.globalVersion++
      this.globalListeners.forEach((fn) => fn())
    }, 250)
  }

  // ---- persistance ----

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), 600)
  }

  flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    try {
      if (this.project) {
        this.project.updatedAt = Date.now()
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.project))
      } else {
        localStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      // Stockage plein ou indisponible : l'export SRT reste toujours possible.
    }
  }

  loadFromStorage(): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return false
      const data = JSON.parse(raw) as ProjectData
      if (data.version !== 1 || !Array.isArray(data.cues) || !Array.isArray(data.rows)) return false
      this.project = data
      this.rowVersions = new Array(data.cues.length).fill(0)
      this.bumpGlobal()
      return true
    } catch {
      return false
    }
  }

  // ---- cycle de vie du projet ----

  newProject(fileName: string, cues: Cue[], srcLang: string, tgtLang: string) {
    const rows: RowState[] = cues.map((cue) => {
      const w = extractWrappers(cue.text)
      return { target: '', wrapOpen: w.open, wrapClose: w.close, edited: false, review: false, reviewNote: '' }
    })
    this.project = {
      version: 1,
      fileName,
      srcLang,
      tgtLang,
      cues,
      rows,
      updatedAt: Date.now(),
    }
    this.activeIndex = -1
    this.rowVersions = new Array(cues.length).fill(0)
    this.bumpGlobal()
    this.flush()
  }

  clearProject() {
    this.project = null
    this.activeIndex = -1
    this.rowVersions = []
    this.bumpGlobal()
    this.flush()
  }

  setLangs(srcLang: string, tgtLang: string) {
    if (!this.project) return
    this.project.srcLang = srcLang
    this.project.tgtLang = tgtLang
    this.bumpGlobal()
  }

  // ---- édition ----

  setTarget(index: number, text: string, opts: { edited?: boolean; review?: boolean; reviewNote?: string } = {}) {
    const row = this.project?.rows[index]
    if (!row) return
    row.target = text
    if (opts.edited !== undefined) row.edited = opts.edited
    else row.edited = true
    if (opts.review !== undefined) {
      row.review = opts.review
      row.reviewNote = opts.reviewNote ?? ''
    } else if (row.review && row.edited) {
      // Une ligne « à vérifier » corrigée à la main redevient normale.
      row.review = false
      row.reviewNote = ''
    }
    this.bumpRow(index)
  }

  setReview(index: number, review: boolean, note = '') {
    const row = this.project?.rows[index]
    if (!row) return
    row.review = review
    row.reviewNote = review ? note : ''
    this.bumpRow(index)
  }

  setActive(index: number) {
    if (this.activeIndex === index) return
    const prev = this.activeIndex
    this.activeIndex = index
    if (prev >= 0) {
      this.rowVersions[prev] = (this.rowVersions[prev] ?? 0) + 1
      this.rowListeners.get(prev)?.forEach((fn) => fn())
    }
    if (index >= 0) {
      this.rowVersions[index] = (this.rowVersions[index] ?? 0) + 1
      this.rowListeners.get(index)?.forEach((fn) => fn())
    }
  }

  // ---- import d'une traduction alignée ----

  applyAlignedRows(
    rows: { sourceId: number; text: string; kind: string }[],
    mode: 'fill-empty' | 'replace',
  ): { applied: number; skippedNonEmpty: number } {
    if (!this.project) return { applied: 0, skippedNonEmpty: 0 }
    let applied = 0
    let skippedNonEmpty = 0
    for (const r of rows) {
      const row = this.project.rows[r.sourceId]
      if (!row) continue
      if (mode === 'fill-empty' && row.target.trim() !== '') {
        skippedNonEmpty++
        continue
      }
      const w = extractWrappers(r.text)
      row.target = w.inner
      row.wrapOpen = w.open !== '' || w.close !== '' ? w.open : row.wrapOpen
      row.wrapClose = w.open !== '' || w.close !== '' ? w.close : row.wrapClose
      row.edited = false
      if (r.kind === 'exact' || r.kind === 'timecode') {
        row.review = false
        row.reviewNote = ''
      } else {
        row.review = true
        row.reviewNote =
          r.kind === 'number'
            ? 'Aligné par numéro seul (timecodes différents)'
            : 'Aligné par ordre (numéros et timecodes différents)'
      }
      applied++
      this.bumpRow(r.sourceId)
    }
    this.bumpGlobal()
    return { applied, skippedNonEmpty }
  }

  markUnmatched(sourceNumbers: number[]) {
    if (!this.project) return
    const byNumber = new Map(this.project.cues.map((c) => [c.number, c.id]))
    for (const n of sourceNumbers) {
      const id = byNumber.get(n)
      if (id === undefined) continue
      const row = this.project.rows[id]
      row.review = true
      row.reviewNote = 'Sans correspondance dans le fichier traduit importé'
      this.bumpRow(id)
    }
    this.bumpGlobal()
  }

  // ---- stats & export ----

  stats(): Stats {
    if (this.statsCache) return this.statsCache
    const s: Stats = { total: 0, translated: 0, empty: 0, edited: 0, review: 0 }
    if (this.project) {
      s.total = this.project.rows.length
      for (const row of this.project.rows) {
        if (row.target.trim() === '') s.empty++
        else s.translated++
        if (row.edited) s.edited++
        if (row.review) s.review++
      }
    }
    this.statsCache = s
    return s
  }

  exportSrt(): string {
    if (!this.project) return ''
    return serializeSrt(
      this.project.cues.map((cue) => ({
        number: cue.number,
        timingRaw: cue.timingRaw,
        text: applyWrappers(
          this.project!.rows[cue.id].wrapOpen,
          this.project!.rows[cue.id].wrapClose,
          this.project!.rows[cue.id].target,
        ),
      })),
    )
  }
}

export const store = new Store()

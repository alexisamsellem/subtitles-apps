import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { store } from './lib/store'
import type { ParseResult } from './lib/srt'
import { SrtParseError, decodeSrtBuffer, parseSrt } from './lib/srt'
import { alignTranslation } from './lib/align'
import type { AiSettings, ContextPair, TranslateItem } from './lib/ai'
import { AiError, BATCH_SIZE, CONTEXT_SIZE, translateBatch } from './lib/ai'
import { LANGUAGES, languageName } from './lib/languages'
import { extractWrappers } from './lib/tags'
import { EmptyState } from './components/EmptyState'
import type { FocusRequest } from './components/SubtitleTable'
import { SubtitleTable } from './components/SubtitleTable'
import type { AiRunState, AlignOutcome } from './components/Modals'
import { AiModal, AlignReportModal, ConfirmModal, HelpModal, ImportModeModal } from './components/Modals'

type Filter = 'all' | 'empty' | 'review' | 'edited'

type ModalState =
  | { kind: 'ai' }
  | { kind: 'align-report'; outcome: AlignOutcome }
  | { kind: 'import-mode'; parsed: ParseResult }
  | { kind: 'confirm-new' }
  | { kind: 'help' }
  | null

interface Toast {
  kind: 'error' | 'info' | 'success'
  text: string
}

async function readSrtFile(file: File): Promise<ParseResult> {
  const buffer = await file.arrayBuffer()
  const { text, encoding } = decodeSrtBuffer(buffer)
  return parseSrt(text, encoding)
}

function guessLangFromName(name: string): string | null {
  const m = name.match(/[._-]([a-z]{2})\.srt$/i)
  if (m && LANGUAGES.some((l) => l.code === m[1].toLowerCase())) return m[1].toLowerCase()
  return null
}

export default function App() {
  useSyncExternalStore(store.subscribe, store.getVersion)
  const project = store.project
  const stats = store.stats()

  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [searchQ, setSearchQ] = useState('')
  const [modal, setModal] = useState<ModalState>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null)
  const [aiRun, setAiRun] = useState<AiRunState>({ running: false, done: 0, total: 0, error: null })

  const searchRef = useRef<HTMLInputElement>(null)
  const translationInputRef = useRef<HTMLInputElement>(null)
  const aiAbortRef = useRef<AbortController | null>(null)
  const focusSeqRef = useRef(0)

  // ---- recherche débouncée ----
  useEffect(() => {
    const t = setTimeout(() => setSearchQ(search.trim().toLowerCase()), 150)
    return () => clearTimeout(t)
  }, [search])

  // ---- toast auto-effacé ----
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.kind === 'error' ? 9000 : 5000)
    return () => clearTimeout(t)
  }, [toast])

  // ---- sauvegarde avant fermeture ----
  useEffect(() => {
    const flush = () => store.flush()
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', flush)
    }
  }, [])

  // ---- lignes visibles selon filtre + recherche ----
  const visibleIds = useMemo(() => {
    if (!project) return []
    const ids: number[] = []
    for (const cue of project.cues) {
      const row = project.rows[cue.id]
      if (filter === 'empty' && row.target.trim() !== '') continue
      if (filter === 'review' && !row.review) continue
      if (filter === 'edited' && !row.edited) continue
      if (searchQ !== '') {
        const hay = `${cue.text}\n${row.target}`.toLowerCase()
        if (!hay.includes(searchQ)) continue
      }
      ids.push(cue.id)
    }
    return ids
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, filter, searchQ, store.getVersion()])

  const visibleIdsRef = useRef(visibleIds)
  visibleIdsRef.current = visibleIds

  const navigate = useCallback((delta: 1 | -1) => {
    const ids = visibleIdsRef.current
    if (ids.length === 0) return
    const pos = ids.indexOf(store.activeIndex)
    const next = pos === -1 ? (delta > 0 ? 0 : ids.length - 1) : Math.min(Math.max(pos + delta, 0), ids.length - 1)
    const id = ids[next]
    store.setActive(id)
    setFocusRequest({ index: id, seq: ++focusSeqRef.current })
  }, [])

  // ---- export ----
  const handleExport = useCallback(() => {
    const p = store.project
    if (!p) return
    if (store.stats().translated === 0) {
      setToast({ kind: 'error', text: 'La colonne cible est entièrement vide — rien à exporter pour l’instant.' })
      return
    }
    store.flush()
    const content = store.exportSrt()
    let base = p.fileName.replace(/\.srt$/i, '')
    base = base.replace(new RegExp(`[._-]${p.srcLang}$`, 'i'), '')
    const name = `${base}.${p.tgtLang}.srt`
    const blob = new Blob([content], { type: 'application/x-subrip;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    const s = store.stats()
    setToast({
      kind: 'success',
      text:
        s.empty > 0
          ? `Export : ${name} (attention, ${s.empty} ligne${s.empty > 1 ? 's' : ''} encore vide${s.empty > 1 ? 's' : ''}).`
          : `Export : ${name} — timecodes d’origine préservés.`,
    })
  }, [])

  // ---- raccourcis clavier globaux ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault()
        navigate(e.key === 'ArrowDown' ? 1 : -1)
      } else if (mod && e.key === 'Enter') {
        e.preventDefault()
        navigate(1)
      } else if (mod && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      } else if (mod && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        handleExport()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, handleExport])

  // ---- import du fichier source ----
  const handleSourceFile = async (file: File) => {
    try {
      const parsed = await readSrtFile(file)
      const guessed = guessLangFromName(file.name)
      const srcLang = guessed ?? 'fr'
      const tgtLang = srcLang === 'en' ? 'fr' : 'en'
      store.newProject(file.name, parsed.cues, srcLang, tgtLang)
      setFilter('all')
      setSearch('')
      if (parsed.warnings.length > 0) {
        setToast({ kind: 'info', text: `Fichier importé (${parsed.cues.length} répliques). ${parsed.warnings.join(' ')}` })
      } else {
        setToast({ kind: 'success', text: `${parsed.cues.length} répliques importées depuis « ${file.name} ».` })
      }
    } catch (err) {
      setToast({
        kind: 'error',
        text: err instanceof SrtParseError ? err.message : 'Impossible de lire ce fichier. Vérifiez qu’il s’agit d’un SRT valide.',
      })
    }
  }

  // ---- import d'une traduction ----
  const applyTranslation = useCallback((parsed: ParseResult, mode: 'fill-empty' | 'replace') => {
    const p = store.project
    if (!p) return
    const { rows, report } = alignTranslation(p.cues, parsed.cues)
    const { applied, skippedNonEmpty } = store.applyAlignedRows(rows, mode)
    store.markUnmatched(report.unmatchedSource)
    setModal({ kind: 'align-report', outcome: { report, applied, skippedNonEmpty, warnings: parsed.warnings } })
  }, [])

  const handleTranslationFile = async (file: File) => {
    try {
      const parsed = await readSrtFile(file)
      if (store.stats().translated > 0) {
        setModal({ kind: 'import-mode', parsed })
      } else {
        applyTranslation(parsed, 'replace')
      }
    } catch (err) {
      setToast({
        kind: 'error',
        text: err instanceof SrtParseError ? err.message : 'Impossible de lire ce fichier de traduction.',
      })
    }
  }

  // ---- traduction IA ----
  const startAi = async (settings: AiSettings) => {
    const p = store.project
    if (!p) return
    const pending: TranslateItem[] = []
    for (const cue of p.cues) {
      if (p.rows[cue.id].target.trim() === '' && cue.text.trim() !== '') {
        pending.push({ n: cue.id, text: extractWrappers(cue.text).inner })
      }
    }
    if (pending.length === 0) return
    setAiRun({ running: true, done: 0, total: pending.length, error: null })
    const ctrl = new AbortController()
    aiAbortRef.current = ctrl
    const context: ContextPair[] = []
    let translated = 0
    try {
      for (let i = 0; i < pending.length; i += BATCH_SIZE) {
        const batch = pending.slice(i, i + BATCH_SIZE)
        const map = await translateBatch(
          settings,
          languageName(p.srcLang),
          languageName(p.tgtLang),
          batch,
          context.slice(-CONTEXT_SIZE),
          ctrl.signal,
        )
        if (map.size === 0) throw new AiError('Le modèle n’a renvoyé aucune traduction exploitable. Réessayez ou changez de modèle.')
        for (const item of batch) {
          const t = map.get(item.n)
          if (t !== undefined && t.trim() !== '') {
            store.setTarget(item.n, t.trim(), { edited: false, review: true, reviewNote: 'Traduite par IA — à relire' })
            context.push({ src: item.text, tgt: t.trim() })
            translated++
          }
        }
        setAiRun({ running: true, done: Math.min(i + batch.length, pending.length), total: pending.length, error: null })
      }
      setAiRun({ running: false, done: pending.length, total: pending.length, error: null })
      setModal(null)
      setToast({
        kind: 'success',
        text: `Traduction IA terminée : ${translated} réplique${translated > 1 ? 's' : ''} remplie${translated > 1 ? 's' : ''}, marquée${translated > 1 ? 's' : ''} « à vérifier ».`,
      })
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setAiRun({ running: false, done: 0, total: 0, error: null })
        setModal(null)
        setToast({ kind: 'info', text: `Traduction arrêtée — ${translated} réplique${translated > 1 ? 's' : ''} déjà remplie${translated > 1 ? 's' : ''} conservée${translated > 1 ? 's' : ''}.` })
      } else {
        setAiRun({
          running: false,
          done: 0,
          total: 0,
          error: err instanceof AiError ? err.message : 'Erreur inattendue pendant la traduction. Réessayez.',
        })
      }
    } finally {
      aiAbortRef.current = null
    }
  }

  // ---- rendu ----
  if (!project) {
    return (
      <>
        <EmptyState onFile={handleSourceFile} />
        {toast && <ToastView toast={toast} onClose={() => setToast(null)} />}
      </>
    )
  }

  const pct = stats.total > 0 ? Math.round((stats.translated / stats.total) * 100) : 0

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__brand">Subtitle&nbsp;Studio</div>
        <div className="topbar__file" title={project.fileName}>
          {project.fileName}
          <span className="topbar__count">{stats.total} répliques</span>
        </div>
        <div className="topbar__langs">
          <select
            value={project.srcLang}
            onChange={(e) => store.setLangs(e.target.value, project.tgtLang)}
            aria-label="Langue source"
            data-testid="src-lang"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
          <span className="topbar__arrow">→</span>
          <select
            value={project.tgtLang}
            onChange={(e) => store.setLangs(project.srcLang, e.target.value)}
            aria-label="Langue cible"
            data-testid="tgt-lang"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </select>
        </div>
        <div className="topbar__actions">
          <button type="button" className="btn" onClick={() => translationInputRef.current?.click()}>
            Importer une traduction
          </button>
          <button type="button" className="btn" onClick={() => setModal({ kind: 'ai' })}>
            Traduire par IA
          </button>
          <button type="button" className="btn btn--primary" onClick={handleExport} data-testid="export-btn">
            Exporter SRT
          </button>
          <button type="button" className="btn btn--icon" title="Raccourcis clavier" onClick={() => setModal({ kind: 'help' })}>
            ?
          </button>
          <button
            type="button"
            className="btn btn--icon"
            title="Nouveau projet (fermer ce fichier)"
            onClick={() => setModal({ kind: 'confirm-new' })}
          >
            ✕
          </button>
        </div>
        <input
          ref={translationInputRef}
          type="file"
          accept=".srt,text/plain,application/x-subrip"
          hidden
          data-testid="translation-file-input"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleTranslationFile(file)
            e.target.value = ''
          }}
        />
      </header>

      <div className="toolbar">
        <input
          ref={searchRef}
          type="search"
          className="toolbar__search"
          placeholder="Rechercher dans les dialogues…  (Ctrl+K)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSearch('')
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          data-testid="search-input"
        />
        <div className="toolbar__filters" role="tablist" aria-label="Filtres">
          {(
            [
              ['all', `Toutes (${stats.total})`],
              ['empty', `Vides (${stats.empty})`],
              ['review', `À vérifier (${stats.review})`],
              ['edited', `Modifiées (${stats.edited})`],
            ] as [Filter, string][]
          ).map(([f, label]) => (
            <button
              key={f}
              type="button"
              className={`filterchip${filter === f ? ' filterchip--on' : ''}`}
              onClick={() => setFilter(f)}
              data-testid={`filter-${f}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="toolbar__progress" title={`${stats.translated} lignes traduites sur ${stats.total}`}>
          <div className="toolbar__progress-bar">
            <div style={{ width: `${pct}%` }} />
          </div>
          <span data-testid="progress-label">{pct}% traduit</span>
        </div>
      </div>

      <SubtitleTable visibleIds={visibleIds} focusRequest={focusRequest} />

      {modal?.kind === 'ai' && (
        <AiModal
          emptyCount={stats.empty}
          run={aiRun}
          onStart={startAi}
          onCancel={() => aiAbortRef.current?.abort()}
          onClose={() => {
            setModal(null)
            setAiRun((r) => ({ ...r, error: null }))
          }}
        />
      )}
      {modal?.kind === 'align-report' && <AlignReportModal outcome={modal.outcome} onClose={() => setModal(null)} />}
      {modal?.kind === 'import-mode' && (
        <ImportModeModal
          translatedCount={stats.translated}
          onChoose={(mode) => {
            const parsed = modal.parsed
            setModal(null)
            applyTranslation(parsed, mode)
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'confirm-new' && (
        <ConfirmModal
          title="Fermer ce projet ?"
          message={`« ${project.fileName} » et ses traductions seront retirés de ce navigateur. Exportez d’abord votre SRT si vous voulez conserver le travail en cours.`}
          confirmLabel="Fermer le projet"
          danger
          onConfirm={() => {
            store.clearProject()
            setModal(null)
            setFilter('all')
            setSearch('')
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === 'help' && <HelpModal onClose={() => setModal(null)} />}

      {toast && <ToastView toast={toast} onClose={() => setToast(null)} />}
    </div>
  )
}

function ToastView({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  return (
    <div className={`toast toast--${toast.kind}`} role="status" data-testid="toast">
      <span>{toast.text}</span>
      <button type="button" onClick={onClose} aria-label="Fermer la notification">✕</button>
    </div>
  )
}

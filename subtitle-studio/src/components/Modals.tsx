import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AiSettings, Provider } from '../lib/ai'
import { DEFAULT_MODELS, loadAiSettings, saveAiSettings } from '../lib/ai'
import type { AlignReport } from '../lib/align'

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal__head">
          <h2>{title}</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  )
}

// ---------- Traduction IA : réglages + lancement ----------

export interface AiRunState {
  running: boolean
  done: number
  total: number
  error: string | null
}

interface AiModalProps {
  emptyCount: number
  run: AiRunState
  onStart: (settings: AiSettings) => void
  onCancel: () => void
  onClose: () => void
}

export function AiModal({ emptyCount, run, onStart, onCancel, onClose }: AiModalProps) {
  const [settings, setSettings] = useState<AiSettings>(() => loadAiSettings())

  const update = (patch: Partial<AiSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveAiSettings(next)
  }

  const changeProvider = (provider: Provider) => {
    const keepModel =
      settings.model !== DEFAULT_MODELS.anthropic && settings.model !== DEFAULT_MODELS.openai
    update({ provider, model: keepModel ? settings.model : DEFAULT_MODELS[provider] })
  }

  const hasKey = settings.apiKey.trim() !== ''

  return (
    <Modal title="Traduire avec une IA" onClose={run.running ? onCancel : onClose}>
      <p className="modal__hint">
        La clé API est conservée <strong>uniquement dans ce navigateur</strong> (localStorage) et envoyée
        directement au fournisseur choisi, jamais ailleurs. Sans clé, l’application reste entièrement
        utilisable : importez une traduction existante ou saisissez-la à la main.
      </p>

      <div className="field-grid">
        <label className="field">
          <span>Fournisseur</span>
          <select
            value={settings.provider}
            disabled={run.running}
            onChange={(e) => changeProvider(e.target.value as Provider)}
          >
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI (GPT)</option>
          </select>
        </label>
        <label className="field">
          <span>Modèle</span>
          <input
            type="text"
            value={settings.model}
            disabled={run.running}
            onChange={(e) => update({ model: e.target.value })}
          />
        </label>
        <label className="field field--wide">
          <span>Clé API {settings.provider === 'anthropic' ? '(sk-ant-…)' : '(sk-…)'}</span>
          <input
            type="password"
            value={settings.apiKey}
            disabled={run.running}
            placeholder={settings.provider === 'anthropic' ? 'sk-ant-api03-…' : 'sk-…'}
            onChange={(e) => update({ apiKey: e.target.value })}
            autoComplete="off"
          />
        </label>
      </div>

      {!hasKey && (
        <p className="modal__limit">
          ⚠ Il manque une clé API pour lancer la traduction automatique — c’est la seule chose que
          l’application ne peut pas fournir elle-même. Créez une clé chez le fournisseur choisi, puis
          collez-la ci-dessus.
        </p>
      )}

      {run.error && <p className="modal__error">{run.error}</p>}

      {run.running ? (
        <div className="ai-progress">
          <div className="ai-progress__bar">
            <div style={{ width: `${run.total > 0 ? (run.done / run.total) * 100 : 0}%` }} />
          </div>
          <p>
            Traduction en cours… {run.done} / {run.total} répliques (par lots, avec contexte).
          </p>
          <div className="modal__actions">
            <button type="button" className="btn" onClick={onCancel}>Arrêter (conserver ce qui est fait)</button>
          </div>
        </div>
      ) : (
        <div className="modal__actions">
          <button type="button" className="btn" onClick={onClose}>Fermer</button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!hasKey || emptyCount === 0}
            title={emptyCount === 0 ? 'Toutes les lignes ont déjà un texte cible' : undefined}
            onClick={() => onStart(settings)}
          >
            Traduire les {emptyCount} lignes vides
          </button>
        </div>
      )}
      <p className="modal__hint modal__hint--small">
        Seules les lignes encore vides sont traduites — vos textes existants ne sont jamais écrasés.
        Les lignes traduites par l’IA sont marquées « à vérifier ». Le contexte des répliques
        précédentes est fourni au modèle pour préserver ton, noms propres et continuité.
      </p>
    </Modal>
  )
}

// ---------- Rapport d'alignement après import d'une traduction ----------

export interface AlignOutcome {
  report: AlignReport
  applied: number
  skippedNonEmpty: number
  warnings: string[]
}

export function AlignReportModal({ outcome, onClose }: { outcome: AlignOutcome; onClose: () => void }) {
  const { report, applied, skippedNonEmpty, warnings } = outcome
  const flagged = report.number + report.order
  const fmtList = (nums: number[]) => {
    const shown = nums.slice(0, 30).join(', ')
    return nums.length > 30 ? `${shown}… (+${nums.length - 30})` : shown
  }
  const perfect =
    flagged === 0 && report.unmatchedSource.length === 0 && report.ignoredTranslated.length === 0
  return (
    <Modal title="Traduction importée" onClose={onClose}>
      <ul className="report">
        <li><strong>{applied}</strong> ligne{applied > 1 ? 's' : ''} remplie{applied > 1 ? 's' : ''} sur {report.total}.</li>
        <li>{report.exact + report.timecode} alignement{report.exact + report.timecode > 1 ? 's' : ''} par numéro et/ou timecode.</li>
        {flagged > 0 && (
          <li className="report--warn">
            {flagged} ligne{flagged > 1 ? 's' : ''} alignée{flagged > 1 ? 's' : ''} de façon incertaine
            (numéro seul ou ordre) — marquée{flagged > 1 ? 's' : ''} <em>à vérifier</em>.
          </li>
        )}
        {skippedNonEmpty > 0 && (
          <li>{skippedNonEmpty} ligne{skippedNonEmpty > 1 ? 's' : ''} non écrasée{skippedNonEmpty > 1 ? 's' : ''} (déjà remplie{skippedNonEmpty > 1 ? 's' : ''}).</li>
        )}
        {report.unmatchedSource.length > 0 && (
          <li className="report--warn">
            Sans correspondance dans le fichier importé (marquées <em>à vérifier</em>) :
            sous-titres n° {fmtList(report.unmatchedSource)}.
          </li>
        )}
        {report.ignoredTranslated.length > 0 && (
          <li className="report--warn">
            Ignorées car sans équivalent dans la source : entrées n° {fmtList(report.ignoredTranslated)} du fichier importé.
          </li>
        )}
        {warnings.map((w) => (
          <li key={w} className="report--warn">{w}</li>
        ))}
        {perfect && <li className="report--ok">Les deux fichiers correspondent parfaitement. ✓</li>}
      </ul>
      <div className="modal__actions">
        <button type="button" className="btn btn--primary" onClick={onClose}>OK</button>
      </div>
    </Modal>
  )
}

// ---------- Choix du mode d'import quand des textes existent déjà ----------

export function ImportModeModal({
  translatedCount,
  onChoose,
  onClose,
}: {
  translatedCount: number
  onChoose: (mode: 'fill-empty' | 'replace') => void
  onClose: () => void
}) {
  return (
    <Modal title="Des traductions existent déjà" onClose={onClose}>
      <p>
        La colonne cible contient déjà {translatedCount} ligne{translatedCount > 1 ? 's' : ''}.
        Comment appliquer le fichier importé ?
      </p>
      <div className="modal__actions modal__actions--stack">
        <button type="button" className="btn btn--primary" onClick={() => onChoose('fill-empty')}>
          Ne remplir que les lignes vides (recommandé)
        </button>
        <button type="button" className="btn btn--danger" onClick={() => onChoose('replace')}>
          Remplacer toutes les lignes par le fichier importé
        </button>
        <button type="button" className="btn" onClick={onClose}>Annuler</button>
      </div>
    </Modal>
  )
}

// ---------- Confirmation générique ----------

export function ConfirmModal({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <p>{message}</p>
      <div className="modal__actions">
        <button type="button" className="btn" onClick={onClose}>Annuler</button>
        <button type="button" className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

// ---------- Aide raccourcis ----------

export function HelpModal({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['Alt + ↓ / Alt + ↑', 'Réplique suivante / précédente'],
    ['Ctrl/⌘ + Entrée', 'Valider et passer à la réplique suivante'],
    ['Ctrl/⌘ + K', 'Rechercher'],
    ['Ctrl/⌘ + S', 'Exporter le SRT traduit'],
    ['Échap', 'Fermer une fenêtre / quitter la recherche'],
  ]
  return (
    <Modal title="Raccourcis clavier" onClose={onClose}>
      <table className="shortcuts">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td><kbd>{k}</kbd></td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="modal__actions">
        <button type="button" className="btn btn--primary" onClick={onClose}>OK</button>
      </div>
    </Modal>
  )
}

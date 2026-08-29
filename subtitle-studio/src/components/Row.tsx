import { memo, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { store } from '../lib/store'
import { sourceToHtml, wrapBadge } from '../lib/tags'

interface RowProps {
  index: number
}

/**
 * Une réplique : méta (n° + timecodes) · source verrouillée · cible éditable.
 * Mémoïsée et abonnée uniquement à sa propre ligne du store : la frappe
 * ici ne re-rend jamais les autres lignes, même sur un fichier de 5000 répliques.
 */
export const Row = memo(function Row({ index }: RowProps) {
  useSyncExternalStore(
    (cb) => store.subscribeRow(index, cb),
    () => store.getRowVersion(index),
  )
  const project = store.project
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const cue = project?.cues[index]
  const row = project?.rows[index]
  const target = row?.target ?? ''

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [target])

  const sourceHtml = useMemo(() => (cue ? sourceToHtml(cue.text) : ''), [cue])

  if (!cue || !row) return null

  const active = store.activeIndex === index
  const isEmpty = target.trim() === ''
  const badge = wrapBadge(row.wrapOpen)

  return (
    <div className={`row${active ? ' row--active' : ''}`} data-row-id={index} onClick={() => store.setActive(index)}>
      <div className="row__meta">
        <div className="row__num">{cue.number}</div>
        <div className="row__tc" title={cue.timingRaw}>
          <span>{cue.startLabel}</span>
          <span className="row__tc-arrow">→</span>
          <span>{cue.endLabel}</span>
        </div>
        <div className="row__badges">
          {badge && (
            <span className="badge badge--style" title={`Style préservé automatiquement à l'export : ${row.wrapOpen}`}>
              {badge}
            </span>
          )}
          {row.edited && <span className="badge badge--edited" title="Modifiée à la main">●</span>}
        </div>
      </div>

      <div className="row__source">
        {cue.text === '' ? (
          <span className="row__source-empty">(sous-titre vide)</span>
        ) : (
          <span dangerouslySetInnerHTML={{ __html: sourceHtml }} />
        )}
      </div>

      <div className={`row__target${row.review ? ' row__target--review' : ''}`}>
        <textarea
          ref={textareaRef}
          rows={1}
          value={target}
          placeholder="Traduction…"
          spellCheck={active}
          onChange={(e) => store.setTarget(index, e.target.value)}
          onFocus={() => store.setActive(index)}
          aria-label={`Traduction de la réplique ${cue.number}`}
        />
        <div className="row__target-tools">
          {row.review ? (
            <button
              type="button"
              className="chip chip--review"
              title={`${row.reviewNote || 'À vérifier'} — cliquer pour marquer comme vérifiée`}
              onClick={(e) => {
                e.stopPropagation()
                store.setReview(index, false)
              }}
            >
              ⚑ à vérifier
            </button>
          ) : (
            <button
              type="button"
              className="chip chip--flag"
              title="Marquer cette ligne « à vérifier »"
              onClick={(e) => {
                e.stopPropagation()
                store.setReview(index, true, 'Marquée à vérifier manuellement')
              }}
            >
              ⚑
            </button>
          )}
          {isEmpty && <span className="chip chip--empty">vide</span>}
        </div>
      </div>
    </div>
  )
})

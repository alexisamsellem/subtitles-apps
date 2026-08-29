import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Row } from './Row'
import { store } from '../lib/store'
import { languageName } from '../lib/languages'

export interface FocusRequest {
  index: number
  seq: number
}

interface TableProps {
  visibleIds: number[]
  focusRequest: FocusRequest | null
}

/**
 * Liste virtualisée : seules les lignes proches de l'écran existent dans le DOM,
 * ce qui garde la révision fluide des petits fichiers jusqu'aux très gros (5000+ répliques).
 */
export function SubtitleTable({ visibleIds, focusRequest }: TableProps) {
  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: visibleIds.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 88,
    overscan: 8,
    getItemKey: (i) => visibleIds[i],
  })

  useEffect(() => {
    if (!focusRequest) return
    const pos = visibleIds.indexOf(focusRequest.index)
    if (pos === -1) return
    virtualizer.scrollToIndex(pos, { align: 'auto' })
    let tries = 0
    const attempt = () => {
      const el = parentRef.current?.querySelector<HTMLTextAreaElement>(
        `[data-row-id="${focusRequest.index}"] textarea`,
      )
      if (el) {
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
      } else if (tries++ < 15) {
        requestAnimationFrame(attempt)
      }
    }
    requestAnimationFrame(attempt)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest])

  return (
    <div className="tablewrap">
      <div className="table__head">
        <div className="table__head-meta">N° · Timecodes</div>
        <div className="table__head-col">Source — {languageName(store.project?.srcLang ?? '')}</div>
        <div className="table__head-col">Traduction — {languageName(store.project?.tgtLang ?? '')} (éditable)</div>
      </div>
      {visibleIds.length === 0 ? (
        <div className="table table--empty">
          <p>Aucune ligne ne correspond au filtre ou à la recherche en cours.</p>
        </div>
      ) : (
        <div className="table" ref={parentRef}>
          <div className="table__body" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vi) => (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                className="table__vrow"
                style={{ transform: `translateY(${vi.start}px)` }}
              >
                <Row index={visibleIds[vi.index]} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

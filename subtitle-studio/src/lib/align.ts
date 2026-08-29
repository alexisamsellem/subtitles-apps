// Alignement d'un fichier SRT déjà traduit sur les sous-titres source.
// Priorité : numéro + timecode, puis timecode seul, puis numéro seul,
// puis ordre (si même nombre de lignes). Tout ce qui n'est pas un
// alignement exact est signalé, jamais appliqué silencieusement.

import type { Cue } from './srt'

export type MatchKind = 'exact' | 'timecode' | 'number' | 'order'

export interface AlignedRow {
  sourceId: number
  text: string
  kind: MatchKind
}

export interface AlignReport {
  total: number
  exact: number
  timecode: number
  number: number
  order: number
  /** Numéros des sous-titres source restés sans correspondance. */
  unmatchedSource: number[]
  /** Numéros des sous-titres du fichier traduit ignorés (sans correspondance). */
  ignoredTranslated: number[]
}

const TIME_TOLERANCE_MS = 500

export function alignTranslation(source: Cue[], translated: Cue[]): { rows: AlignedRow[]; report: AlignReport } {
  const rows: AlignedRow[] = []
  const usedTranslated = new Set<number>()
  const matchedSource = new Set<number>()

  const byNumber = new Map<number, Cue[]>()
  for (const t of translated) {
    const list = byNumber.get(t.number) ?? []
    list.push(t)
    byNumber.set(t.number, list)
  }

  const take = (src: Cue, t: Cue, kind: MatchKind) => {
    usedTranslated.add(t.id)
    matchedSource.add(src.id)
    rows.push({ sourceId: src.id, text: t.text, kind })
  }

  // Passe 1 : même numéro ET timecode de début identique (±100 ms).
  for (const src of source) {
    const candidates = (byNumber.get(src.number) ?? []).filter((t) => !usedTranslated.has(t.id))
    const hit = candidates.find((t) => Math.abs(t.startMs - src.startMs) <= 100)
    if (hit) take(src, hit, 'exact')
  }

  // Passe 2 : timecode de début proche (±500 ms), sans exiger le même numéro.
  const remainingByStart = translated.filter((t) => !usedTranslated.has(t.id))
  for (const src of source) {
    if (matchedSource.has(src.id)) continue
    let best: Cue | null = null
    let bestDelta = TIME_TOLERANCE_MS + 1
    for (const t of remainingByStart) {
      if (usedTranslated.has(t.id)) continue
      const delta = Math.abs(t.startMs - src.startMs)
      if (delta <= TIME_TOLERANCE_MS && delta < bestDelta) {
        best = t
        bestDelta = delta
      }
    }
    if (best) take(src, best, 'timecode')
  }

  // Passe 3 : numéro seul (timecodes différents) — à vérifier.
  for (const src of source) {
    if (matchedSource.has(src.id)) continue
    const candidates = (byNumber.get(src.number) ?? []).filter((t) => !usedTranslated.has(t.id))
    if (candidates.length === 1) take(src, candidates[0], 'number')
  }

  // Passe 4 : aucun appariement trouvé (fichier entièrement renuméroté/recalé)
  // mais même nombre de lignes → alignement par ordre, tout est marqué à vérifier.
  // Jamais utilisée pour « boucher les trous » d'un alignement partiel : cela
  // décalerait silencieusement des contenus sans rapport.
  if (rows.length === 0 && source.length === translated.length) {
    for (let i = 0; i < source.length; i++) take(source[i], translated[i], 'order')
  }

  const report: AlignReport = {
    total: source.length,
    exact: rows.filter((r) => r.kind === 'exact').length,
    timecode: rows.filter((r) => r.kind === 'timecode').length,
    number: rows.filter((r) => r.kind === 'number').length,
    order: rows.filter((r) => r.kind === 'order').length,
    unmatchedSource: source.filter((s) => !matchedSource.has(s.id)).map((s) => s.number),
    ignoredTranslated: translated.filter((t) => !usedTranslated.has(t.id)).map((t) => t.number),
  }

  return { rows, report }
}

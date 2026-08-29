// Analyse et sérialisation de fichiers SRT.
// Objectif : tolérance maximale à l'import, préservation exacte à l'export.

export interface Cue {
  /** Position dans le fichier source (0-based), stable pour toute la session. */
  id: number
  /** Numéro affiché dans le fichier source (ou attribué si absent). */
  number: number
  /** Ligne de timecode exacte du fichier source, réémise telle quelle à l'export. */
  timingRaw: string
  startMs: number
  endMs: number
  /** Timecodes normalisés pour l'affichage. */
  startLabel: string
  endLabel: string
  /** Texte brut du sous-titre, lignes séparées par \n (balises incluses). */
  text: string
}

export interface ParseResult {
  cues: Cue[]
  warnings: string[]
  encoding: string
}

export class SrtParseError extends Error {}

const TIMING_RE =
  /^(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})(\s.*)?$/

function toMs(h: string, m: string, s: string, frac: string): number {
  const ms = Number(frac.padEnd(3, '0'))
  return Number(h) * 3600_000 + Number(m) * 60_000 + Number(s) * 1000 + ms
}

export function msToLabel(total: number): string {
  const h = Math.floor(total / 3600_000)
  const m = Math.floor((total % 3600_000) / 60_000)
  const s = Math.floor((total % 60_000) / 1000)
  const ms = total % 1000
  const p = (n: number, w: number) => String(n).padStart(w, '0')
  return `${p(h, 2)}:${p(m, 2)}:${p(s, 2)},${p(ms, 3)}`
}

/** Décode un fichier en essayant UTF-8 strict puis windows-1252 (accents des anciens fichiers). */
export function decodeSrtBuffer(buffer: ArrayBuffer): { text: string; encoding: string } {
  const bytes = new Uint8Array(buffer)
  const probe = bytes.subarray(0, Math.min(bytes.length, 4096))
  if (probe.includes(0)) {
    // UTF-16 avec BOM ? Sinon, fichier binaire.
    if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
      const enc = bytes[0] === 0xff ? 'utf-16le' : 'utf-16be'
      return { text: new TextDecoder(enc).decode(buffer), encoding: enc }
    }
    throw new SrtParseError(
      'Ce fichier ne semble pas être un fichier de sous-titres texte. Vérifiez qu’il s’agit bien d’un fichier .srt.',
    )
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('windows-1252').decode(buffer), encoding: 'windows-1252' }
  }
}

interface Block {
  lineNo: number
  lines: string[]
}

function splitBlocks(text: string): Block[] {
  const lines = text.split('\n')
  const blocks: Block[] = []
  let current: string[] = []
  let currentStart = 0
  const push = () => {
    if (current.some((l) => l.trim() !== '')) blocks.push({ lineNo: currentStart + 1, lines: current })
    current = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') {
      push()
      currentStart = i + 1
      continue
    }
    // Fichiers mal formés : nouveau bloc collé sans ligne vide
    // (une ligne purement numérique immédiatement suivie d'un timecode).
    if (current.length > 0 && /^\d+$/.test(line.trim()) && i + 1 < lines.length && TIMING_RE.test(lines[i + 1].trim())) {
      push()
      currentStart = i
    }
    current.push(line)
  }
  push()
  return blocks
}

export function parseSrt(raw: string, encoding = 'utf-8'): ParseResult {
  let text = raw
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  text = text.replace(/\r\n?/g, '\n')

  if (/^\s*WEBVTT/.test(text)) {
    throw new SrtParseError(
      'Ce fichier est au format WebVTT (.vtt), pas SRT. Convertissez-le en .srt avant de l’importer.',
    )
  }

  const blocks = splitBlocks(text)
  const cues: Cue[] = []
  const warnings: string[] = []
  let skipped = 0

  for (const block of blocks) {
    // Le timecode doit se trouver dans les 2 premières lignes du bloc.
    let timingIdx = -1
    for (let i = 0; i < Math.min(block.lines.length, 2); i++) {
      if (TIMING_RE.test(block.lines[i].trim())) {
        timingIdx = i
        break
      }
    }
    if (timingIdx === -1) {
      skipped++
      if (warnings.length < 5) {
        const preview = block.lines[0].trim().slice(0, 40)
        warnings.push(`Bloc ignoré (ligne ${block.lineNo}) : timecode introuvable — « ${preview}… »`)
      }
      continue
    }
    const timingLine = block.lines[timingIdx].trim()
    const m = timingLine.match(TIMING_RE)!
    const startMs = toMs(m[1], m[2], m[3], m[4])
    const endMs = toMs(m[5], m[6], m[7], m[8])

    let number = cues.length + 1
    if (timingIdx > 0) {
      const numLine = block.lines[timingIdx - 1].trim()
      if (/^\d+$/.test(numLine)) number = Number(numLine)
    }

    const textLines = block.lines.slice(timingIdx + 1).map((l) => l.replace(/\s+$/, ''))
    while (textLines.length > 0 && textLines[textLines.length - 1] === '') textLines.pop()

    cues.push({
      id: cues.length,
      number,
      timingRaw: timingLine,
      startMs,
      endMs,
      startLabel: msToLabel(startMs),
      endLabel: msToLabel(endMs),
      text: textLines.join('\n'),
    })
  }

  if (cues.length === 0) {
    throw new SrtParseError(
      'Aucun sous-titre reconnu dans ce fichier. Vérifiez qu’il s’agit d’un fichier SRT valide (numéro, timecode « 00:00:01,000 --> 00:00:02,000 », puis texte).',
    )
  }
  if (skipped > 5) warnings.push(`… et ${skipped - 5} autres blocs ignorés.`)
  if (encoding !== 'utf-8') {
    warnings.push(
      `Le fichier n’était pas en UTF-8 (détecté : ${encoding}). Les accents ont été convertis automatiquement ; l’export sera en UTF-8.`,
    )
  }

  return { cues, warnings, encoding }
}

export interface ExportEntry {
  number: number
  timingRaw: string
  text: string
}

/** Sérialise en SRT valide : CRLF, ligne vide entre blocs, UTF-8 (au moment du Blob). */
export function serializeSrt(entries: ExportEntry[]): string {
  const blocks = entries.map((e) => {
    const head = `${e.number}\r\n${e.timingRaw}`
    const body = e.text.length > 0 ? '\r\n' + e.text.split('\n').join('\r\n') : ''
    return head + body + '\r\n'
  })
  return blocks.join('\r\n')
}

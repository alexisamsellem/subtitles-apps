// Gestion des balises de style SRT (<i>, <b>, <font…>, {\an8}…).
// Principe : les balises qui enveloppent toute la réplique sont extraites
// de la zone d'édition et réappliquées automatiquement à l'export.

export interface Wrappers {
  open: string
  close: string
  inner: string
}

const WRAP_TAGS = ['i', 'b', 'u', 'em', 'strong', 'font'] as const

const TAG_TOKEN = /<\/?([a-zA-Z][a-zA-Z0-9]*)(?:\s[^<>]*)?>/g

/** Vérifie que le texte entier est enveloppé par une paire tag…/tag équilibrée. */
function fullWrapMatch(text: string): { tag: string; openRaw: string; inner: string } | null {
  const openMatch = text.match(/^<([a-zA-Z][a-zA-Z0-9]*)(\s[^<>]*)?>/)
  if (!openMatch) return null
  const tag = openMatch[1].toLowerCase()
  if (!(WRAP_TAGS as readonly string[]).includes(tag)) return null
  const closeRe = new RegExp(`</${tag}\\s*>\\s*$`, 'i')
  const closeMatch = text.match(closeRe)
  if (!closeMatch) return null
  const inner = text.slice(openMatch[0].length, text.length - closeMatch[0].length)
  // La profondeur ne doit jamais retomber à zéro avant la fin
  // (rejette « <i>a</i> et <i>b</i> » qui n'est pas entièrement enveloppé).
  let depth = 1
  TAG_TOKEN.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TAG_TOKEN.exec(inner)) !== null) {
    if (m[1].toLowerCase() !== tag) continue
    depth += m[0].startsWith('</') ? -1 : 1
    if (depth <= 0) return null
  }
  if (depth !== 1) return null
  return { tag, openRaw: openMatch[0], inner }
}

/** Extrait les enveloppes de style : préfixes {\an8}… puis paires de balises complètes. */
export function extractWrappers(text: string): Wrappers {
  let open = ''
  let close = ''
  let inner = text.trim()

  // Tags de position type ASS ({\an8}) en tête de réplique.
  let assMatch
  while ((assMatch = inner.match(/^\{\\[^}]*\}\s*/)) !== null) {
    open += assMatch[0].trim()
    inner = inner.slice(assMatch[0].length)
  }

  for (;;) {
    const wrap = fullWrapMatch(inner)
    if (!wrap) break
    open += wrap.openRaw
    close = `</${wrap.tag}>` + close
    inner = wrap.inner.trim()
  }

  return { open, close, inner }
}

/**
 * Réapplique les enveloppes à un texte saisi sans balises.
 * Si l'utilisateur a lui-même écrit des balises, son texte est respecté tel quel.
 */
export function applyWrappers(open: string, close: string, text: string): string {
  const trimmed = text.trim()
  if (trimmed === '') return ''
  if (open === '' && close === '') return trimmed
  if (/[<{]/.test(trimmed)) return trimmed
  return open + trimmed + close
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const SAFE_COLOR = /^#?[0-9a-zA-Z]{1,20}$/

/**
 * Convertit un texte SRT brut en HTML sûr pour l'affichage de la colonne source :
 * balises de style rendues visuellement, balises techniques masquées, tout le reste échappé.
 */
export function sourceToHtml(text: string): string {
  let html = ''
  let last = 0
  const re = /<\/?([a-zA-Z][a-zA-Z0-9.]*)((?:\s[^<>]*)?)>|\{\\[^}]*\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    html += escapeHtml(text.slice(last, m.index))
    last = m.index + m[0].length
    if (m[0].startsWith('{')) continue // tag de position : masqué à l'affichage
    const tag = (m[1] ?? '').toLowerCase()
    const closing = m[0].startsWith('</')
    if (tag === 'i' || tag === 'em') html += closing ? '</i>' : '<i>'
    else if (tag === 'b' || tag === 'strong') html += closing ? '</b>' : '<b>'
    else if (tag === 'u') html += closing ? '</u>' : '<u>'
    else if (tag === 'font') {
      if (closing) html += '</span>'
      else {
        const colorMatch = (m[2] ?? '').match(/color\s*=\s*["']?([^"'\s>]+)["']?/i)
        const color = colorMatch && SAFE_COLOR.test(colorMatch[1]) ? colorMatch[1] : null
        html += color ? `<span style="color:${color.startsWith('#') || /^[a-zA-Z]+$/.test(color) ? color : '#' + color}">` : '<span>'
      }
    }
    // autres balises (<c.xxx>, <v Nom>…) : masquées, le texte reste visible
  }
  html += escapeHtml(text.slice(last))
  return html.replace(/\n/g, '<br>')
}

/** Résumé lisible des enveloppes pour un badge (ex. « italique »). */
export function wrapBadge(open: string): string | null {
  if (open === '') return null
  const parts: string[] = []
  if (/<i[\s>]/.test(open + ' ') || open.includes('<i>')) parts.push('italique')
  if (open.includes('<b>')) parts.push('gras')
  if (open.includes('<u>')) parts.push('souligné')
  if (/<font/i.test(open)) parts.push('couleur')
  if (/\{\\/.test(open)) parts.push('position')
  return parts.length > 0 ? parts.join(' + ') : 'style'
}

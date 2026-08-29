import { describe, expect, it } from 'vitest'
import { applyWrappers, extractWrappers, sourceToHtml } from './tags'

describe('extractWrappers', () => {
  it('extrait une balise italique englobante', () => {
    const w = extractWrappers('<i>Le vent se lève…</i>')
    expect(w).toEqual({ open: '<i>', close: '</i>', inner: 'Le vent se lève…' })
  })

  it('extrait des balises imbriquées', () => {
    const w = extractWrappers('<i><b>Fort</b></i>')
    expect(w.open).toBe('<i><b>')
    expect(w.close).toBe('</b></i>')
    expect(w.inner).toBe('Fort')
  })

  it('ne touche pas aux balises partielles au milieu du texte', () => {
    const w = extractWrappers('Où est passé <b>Édouard</b> ?')
    expect(w.open).toBe('')
    expect(w.inner).toBe('Où est passé <b>Édouard</b> ?')
  })

  it('rejette le faux englobement <i>a</i> et <i>b</i>', () => {
    const w = extractWrappers('<i>a</i> et <i>b</i>')
    expect(w.open).toBe('')
    expect(w.inner).toBe('<i>a</i> et <i>b</i>')
  })

  it('extrait les tags de position {\\an8}', () => {
    const w = extractWrappers('{\\an8}PORT DE SAINT-MALO')
    expect(w.open).toBe('{\\an8}')
    expect(w.close).toBe('')
    expect(w.inner).toBe('PORT DE SAINT-MALO')
  })

  it('extrait une balise font avec attribut', () => {
    const w = extractWrappers('<font color="#ffcc00">— Compris ?</font>')
    expect(w.open).toBe('<font color="#ffcc00">')
    expect(w.close).toBe('</font>')
    expect(w.inner).toBe('— Compris ?')
  })
})

describe('applyWrappers', () => {
  it('réapplique le style à un texte traduit sans balises', () => {
    expect(applyWrappers('<i>', '</i>', 'The wind is rising…')).toBe('<i>The wind is rising…</i>')
  })

  it('n’enveloppe pas un texte vide', () => {
    expect(applyWrappers('<i>', '</i>', '   ')).toBe('')
  })

  it('respecte un texte qui contient déjà des balises', () => {
    expect(applyWrappers('<i>', '</i>', 'Where has <b>Édouard</b> gone?')).toBe('Where has <b>Édouard</b> gone?')
  })

  it('round-trip extract + apply = identité', () => {
    const original = '<i>Il a filé à l’anglaise,\ncomme d’habitude.</i>'
    const w = extractWrappers(original)
    expect(applyWrappers(w.open, w.close, w.inner)).toBe(original)
  })
})

describe('sourceToHtml', () => {
  it('rend les balises de style et échappe le reste', () => {
    expect(sourceToHtml('<i>Salut</i> & "bye" <script>x</script>')).toBe(
      '<i>Salut</i> &amp; &quot;bye&quot; x',
    )
  })

  it('masque les tags de position et rend les retours à la ligne', () => {
    expect(sourceToHtml('{\\an8}Ligne 1\nLigne 2')).toBe('Ligne 1<br>Ligne 2')
  })

  it('rend la couleur des balises font sûres uniquement', () => {
    expect(sourceToHtml('<font color="#ffcc00">Hé</font>')).toBe('<span style="color:#ffcc00">Hé</span>')
    expect(sourceToHtml('<font color=\'red;x:url(1)\'>Hé</font>')).toBe('<span>Hé</span>')
  })
})

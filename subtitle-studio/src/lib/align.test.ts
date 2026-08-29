import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { alignTranslation } from './align'
import { parseSrt } from './srt'

const here = dirname(fileURLToPath(import.meta.url))

function cuesOf(text: string) {
  return parseSrt(text).cues
}

describe('alignTranslation', () => {
  it('aligne parfaitement deux fichiers identiques en structure', () => {
    const src = cuesOf('1\n00:00:01,000 --> 00:00:02,000\nBonjour\n\n2\n00:00:03,000 --> 00:00:04,000\nAu revoir\n')
    const tr = cuesOf('1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nGoodbye\n')
    const { rows, report } = alignTranslation(src, tr)
    expect(report.exact).toBe(2)
    expect(report.unmatchedSource).toEqual([])
    expect(report.ignoredTranslated).toEqual([])
    expect(rows.find((r) => r.sourceId === 0)?.text).toBe('Hello')
  })

  it('aligne par timecode quand la numérotation diffère', () => {
    const src = cuesOf('5\n00:00:01,000 --> 00:00:02,000\nBonjour\n')
    const tr = cuesOf('1\n00:00:01,200 --> 00:00:02,000\nHello\n')
    const { rows, report } = alignTranslation(src, tr)
    expect(report.timecode).toBe(1)
    expect(rows[0].kind).toBe('timecode')
  })

  it('aligne par numéro seul en marquant la ligne à vérifier', () => {
    const src = cuesOf('7\n00:00:01,000 --> 00:00:02,000\nBonjour\n')
    const tr = cuesOf('7\n00:01:40,000 --> 00:01:41,000\nHello\n')
    const { rows } = alignTranslation(src, tr)
    expect(rows[0].kind).toBe('number')
  })

  it('aligne par ordre quand tout diffère mais que le compte est identique', () => {
    const src = cuesOf('1\n00:00:01,000 --> 00:00:02,000\nA\n\n2\n00:00:03,000 --> 00:00:04,000\nB\n')
    const tr = cuesOf('10\n00:10:00,000 --> 00:10:01,000\nA2\n\n20\n00:10:03,000 --> 00:10:04,000\nB2\n')
    const { rows } = alignTranslation(src, tr)
    expect(rows.map((r) => r.kind)).toEqual(['order', 'order'])
    expect(rows[0].text).toBe('A2')
  })

  it('signale les lignes sans correspondance au lieu de décaler silencieusement', () => {
    const src = cuesOf(
      '1\n00:00:01,000 --> 00:00:02,000\nA\n\n2\n00:00:03,000 --> 00:00:04,000\nB\n\n3\n00:00:05,000 --> 00:00:06,000\nC\n',
    )
    // La traduction n'a pas la ligne 2 et contient une ligne étrangère.
    const tr = cuesOf(
      '1\n00:00:01,000 --> 00:00:02,000\nA2\n\n3\n00:00:05,000 --> 00:00:06,000\nC2\n\n99\n00:09:00,000 --> 00:09:01,000\nZZZ\n',
    )
    const { rows, report } = alignTranslation(src, tr)
    expect(report.unmatchedSource).toEqual([2])
    expect(report.ignoredTranslated).toEqual([99])
    // La ligne 3 ne doit PAS recevoir le texte de la ligne 2 : pas de décalage.
    expect(rows.find((r) => r.sourceId === 2)?.text).toBe('C2')
    expect(rows.find((r) => r.sourceId === 1)).toBeUndefined()
  })

  it('aligne les fichiers de démonstration comme attendu', () => {
    const src = parseSrt(readFileSync(join(here, '../../demo/source_fr.srt'), 'utf-8')).cues
    const tr = parseSrt(readFileSync(join(here, '../../demo/target_en.srt'), 'utf-8')).cues
    const { report } = alignTranslation(src, tr)
    expect(report.exact).toBe(5)
    expect(report.timecode).toBe(5)
    expect(report.unmatchedSource).toEqual([6, 11])
    expect(report.ignoredTranslated).toEqual([99])
  })
})

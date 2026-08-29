import { describe, expect, it } from 'vitest'
import { SrtParseError, decodeSrtBuffer, parseSrt, serializeSrt } from './srt'

const SIMPLE = `1
00:00:01,000 --> 00:00:03,400
Bonjour, capitaine Aurélie.

2
00:00:03,600 --> 00:00:06,200
<i>Le vent se lève…</i>
`

describe('parseSrt', () => {
  it('analyse numéros, timecodes et textes', () => {
    const { cues } = parseSrt(SIMPLE)
    expect(cues).toHaveLength(2)
    expect(cues[0].number).toBe(1)
    expect(cues[0].startMs).toBe(1000)
    expect(cues[0].endMs).toBe(3400)
    expect(cues[0].startLabel).toBe('00:00:01,000')
    expect(cues[0].text).toBe('Bonjour, capitaine Aurélie.')
    expect(cues[1].text).toBe('<i>Le vent se lève…</i>')
  })

  it('gère CRLF, BOM et dialogues multi-lignes', () => {
    const crlf = '﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nLigne 1\r\nLigne 2\r\n\r\n'
    const { cues } = parseSrt(crlf)
    expect(cues).toHaveLength(1)
    expect(cues[0].text).toBe('Ligne 1\nLigne 2')
  })

  it('accepte les sous-titres vides', () => {
    const src = '1\n00:00:01,000 --> 00:00:02,000\n\n2\n00:00:03,000 --> 00:00:04,000\nTexte\n'
    const { cues } = parseSrt(src)
    expect(cues).toHaveLength(2)
    expect(cues[0].text).toBe('')
    expect(cues[1].text).toBe('Texte')
  })

  it('accepte les millisecondes en point et blocs sans numéro', () => {
    const src = '00:00:01.500 --> 00:00:02.500\nSans numéro\n'
    const { cues } = parseSrt(src)
    expect(cues[0].startMs).toBe(1500)
    expect(cues[0].number).toBe(1)
  })

  it('sépare les blocs collés (fichier mal formé)', () => {
    const src = '1\n00:00:01,000 --> 00:00:02,000\nA\n2\n00:00:03,000 --> 00:00:04,000\nB\n'
    const { cues } = parseSrt(src)
    expect(cues).toHaveLength(2)
    expect(cues[0].text).toBe('A')
    expect(cues[1].text).toBe('B')
  })

  it('rejette un fichier sans sous-titres avec un message clair', () => {
    expect(() => parseSrt('bonjour tout le monde')).toThrow(SrtParseError)
    expect(() => parseSrt('bonjour tout le monde')).toThrow(/Aucun sous-titre reconnu/)
  })

  it('rejette le WebVTT avec un message explicite', () => {
    expect(() => parseSrt('WEBVTT\n\n00:01.000 --> 00:02.000\nHi')).toThrow(/WebVTT/)
  })

  it('signale les blocs invalides sans tout rejeter', () => {
    const src = 'garbage sans timecode\n\n1\n00:00:01,000 --> 00:00:02,000\nOK\n'
    const { cues, warnings } = parseSrt(src)
    expect(cues).toHaveLength(1)
    expect(warnings.length).toBeGreaterThan(0)
  })
})

describe('decodeSrtBuffer', () => {
  it('décode UTF-8 avec accents', () => {
    const buf = new TextEncoder().encode('1\n00:00:01,000 --> 00:00:02,000\nÉté à Provins — ça va ?\n')
    const { text, encoding } = decodeSrtBuffer(buf.buffer as ArrayBuffer)
    expect(encoding).toBe('utf-8')
    expect(text).toContain('Été à Provins — ça va ?')
  })

  it('retombe sur windows-1252 pour les vieux fichiers', () => {
    // « été » encodé en latin-1 : 0xE9 n'est pas de l'UTF-8 valide.
    const bytes = new Uint8Array([0x31, 0x0a, ...new TextEncoder().encode('00:00:01,000 --> 00:00:02,000\n'), 0xe9, 0x74, 0xe9, 0x0a])
    const { text, encoding } = decodeSrtBuffer(bytes.buffer as ArrayBuffer)
    expect(encoding).toBe('windows-1252')
    expect(text).toContain('été')
  })

  it('rejette les fichiers binaires', () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02, 0x03])
    expect(() => decodeSrtBuffer(bytes.buffer as ArrayBuffer)).toThrow(SrtParseError)
  })
})

describe('serializeSrt', () => {
  it('émet un SRT valide en CRLF avec les timecodes intacts', () => {
    const { cues } = parseSrt(SIMPLE)
    const out = serializeSrt(cues.map((c) => ({ number: c.number, timingRaw: c.timingRaw, text: 'X' })))
    expect(out).toBe(
      '1\r\n00:00:01,000 --> 00:00:03,400\r\nX\r\n\r\n2\r\n00:00:03,600 --> 00:00:06,200\r\nX\r\n',
    )
  })

  it('préserve un timecode source inhabituel à l’identique', () => {
    const src = '1\n0:00:01.5 --> 0:00:02.75  X1:100\nTexte\n'
    const { cues } = parseSrt(src)
    const out = serializeSrt([{ number: 1, timingRaw: cues[0].timingRaw, text: 'T' }])
    expect(out).toContain('0:00:01.5 --> 0:00:02.75  X1:100')
  })

  it('gère les textes vides et les caractères spéciaux', () => {
    const out = serializeSrt([
      { number: 1, timingRaw: '00:00:01,000 --> 00:00:02,000', text: '' },
      { number: 2, timingRaw: '00:00:03,000 --> 00:00:04,000', text: '« Œuvre » — à 100 %\ndeuxième ligne' },
    ])
    expect(out).toBe(
      '1\r\n00:00:01,000 --> 00:00:02,000\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\n« Œuvre » — à 100 %\r\ndeuxième ligne\r\n',
    )
  })

  it('round-trip : parse(serialize(x)) == x', () => {
    const { cues } = parseSrt(SIMPLE)
    const out = serializeSrt(cues.map((c) => ({ number: c.number, timingRaw: c.timingRaw, text: c.text })))
    const again = parseSrt(out)
    expect(again.cues.map((c) => [c.number, c.startMs, c.endMs, c.text])).toEqual(
      cues.map((c) => [c.number, c.startMs, c.endMs, c.text]),
    )
  })
})

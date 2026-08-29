export interface Language {
  code: string
  name: string
}

export const LANGUAGES: Language[] = [
  { code: 'fr', name: 'Français' },
  { code: 'en', name: 'Anglais' },
  { code: 'es', name: 'Espagnol' },
  { code: 'de', name: 'Allemand' },
  { code: 'it', name: 'Italien' },
  { code: 'pt', name: 'Portugais' },
  { code: 'nl', name: 'Néerlandais' },
  { code: 'pl', name: 'Polonais' },
  { code: 'ru', name: 'Russe' },
  { code: 'uk', name: 'Ukrainien' },
  { code: 'ar', name: 'Arabe' },
  { code: 'he', name: 'Hébreu' },
  { code: 'tr', name: 'Turc' },
  { code: 'ja', name: 'Japonais' },
  { code: 'ko', name: 'Coréen' },
  { code: 'zh', name: 'Chinois' },
  { code: 'hi', name: 'Hindi' },
  { code: 'sv', name: 'Suédois' },
  { code: 'da', name: 'Danois' },
  { code: 'no', name: 'Norvégien' },
  { code: 'fi', name: 'Finnois' },
  { code: 'cs', name: 'Tchèque' },
  { code: 'ro', name: 'Roumain' },
  { code: 'el', name: 'Grec' },
]

export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code
}

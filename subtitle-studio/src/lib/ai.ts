// Traduction par IA : deux fournisseurs interchangeables (Anthropic, OpenAI).
// La clé API est saisie dans l'interface et conservée uniquement dans le
// navigateur (localStorage). L'application reste entièrement utilisable sans clé.

export type Provider = 'anthropic' | 'openai'

export interface AiSettings {
  provider: Provider
  apiKey: string
  model: string
}

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-5-mini',
}

const AI_STORAGE_KEY = 'subtitle-studio:ai:v1'

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(AI_STORAGE_KEY)
    if (raw) {
      const s = JSON.parse(raw) as AiSettings
      if (s.provider === 'anthropic' || s.provider === 'openai') {
        return { provider: s.provider, apiKey: s.apiKey ?? '', model: s.model || DEFAULT_MODELS[s.provider] }
      }
    }
  } catch {
    // paramètres illisibles : repartir des valeurs par défaut
  }
  return { provider: 'anthropic', apiKey: '', model: DEFAULT_MODELS.anthropic }
}

export function saveAiSettings(s: AiSettings) {
  try {
    localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(s))
  } catch {
    // stockage indisponible : la clé ne sera pas retenue entre deux sessions
  }
}

export interface TranslateItem {
  n: number
  text: string
}

export interface ContextPair {
  src: string
  tgt: string
}

export class AiError extends Error {}

function buildPrompt(srcLang: string, tgtLang: string, items: TranslateItem[], context: ContextPair[]): string {
  const contextBlock =
    context.length > 0
      ? `Répliques précédentes déjà traduites (pour la continuité du dialogue, ne PAS les retraduire) :\n${context
          .map((c) => `- ${JSON.stringify(c.src)} → ${JSON.stringify(c.tgt)}`)
          .join('\n')}\n\n`
      : ''
  return (
    `Tu es un traducteur professionnel de sous-titres, de « ${srcLang} » vers « ${tgtLang} ».\n` +
    `Règles impératives :\n` +
    `- Préserve le ton, le registre et la continuité du dialogue.\n` +
    `- Ne traduis jamais les noms propres ; garde-les identiques d'une réplique à l'autre.\n` +
    `- Reste concis : longueur adaptée à la lecture (≈ 42 caractères par ligne, 2 lignes maximum).\n` +
    `- Conserve les retours à la ligne (\\n) quand la réplique en contient.\n` +
    `- N'ajoute ni guillemets ni commentaires ; traduis uniquement.\n\n` +
    contextBlock +
    `Traduis chacune des répliques suivantes. Réponds UNIQUEMENT avec un objet JSON de la forme ` +
    `{"items":[{"n":<numéro>,"t":"<traduction>"}]} sans aucun autre texte.\n\n` +
    `Répliques :\n${JSON.stringify(items.map((i) => ({ n: i.n, text: i.text })), null, 0)}`
  )
}

function parseModelJson(text: string, expected: TranslateItem[]): Map<number, string> {
  let jsonText = text.trim()
  const fence = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) jsonText = fence[1].trim()
  const start = jsonText.indexOf('{')
  const end = jsonText.lastIndexOf('}')
  if (start === -1 || end === -1) throw new AiError('Réponse du modèle illisible (pas de JSON).')
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText.slice(start, end + 1))
  } catch {
    throw new AiError('Réponse du modèle illisible (JSON invalide).')
  }
  const items = (parsed as { items?: unknown }).items
  if (!Array.isArray(items)) throw new AiError('Réponse du modèle inattendue (liste « items » absente).')
  const map = new Map<number, string>()
  const expectedNumbers = new Set(expected.map((e) => e.n))
  for (const it of items) {
    const n = (it as { n?: unknown }).n
    const t = (it as { t?: unknown }).t
    if (typeof n === 'number' && typeof t === 'string' && expectedNumbers.has(n)) map.set(n, t)
  }
  return map
}

function friendlyHttpError(status: number, provider: Provider): AiError {
  const name = provider === 'anthropic' ? 'Anthropic' : 'OpenAI'
  if (status === 401 || status === 403) return new AiError(`Clé API ${name} refusée. Vérifiez la clé dans les réglages IA.`)
  if (status === 429) return new AiError(`Limite de débit ${name} atteinte. Réessayez dans quelques instants.`)
  if (status === 404) return new AiError(`Modèle introuvable chez ${name}. Vérifiez le nom du modèle dans les réglages IA.`)
  if (status >= 500) return new AiError(`Le service ${name} est momentanément indisponible (erreur ${status}).`)
  return new AiError(`Erreur ${name} (HTTP ${status}).`)
}

async function callAnthropic(settings: AiSettings, prompt: string, signal: AbortSignal): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw friendlyHttpError(res.status, 'anthropic')
  const data = (await res.json()) as { content?: { type: string; text?: string }[] }
  const text = (data.content ?? []).map((b) => (b.type === 'text' ? (b.text ?? '') : '')).join('')
  if (!text) throw new AiError('Réponse Anthropic vide.')
  return text
}

async function callOpenAi(settings: AiSettings, prompt: string, signal: AbortSignal): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw friendlyHttpError(res.status, 'openai')
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = data.choices?.[0]?.message?.content
  if (!text) throw new AiError('Réponse OpenAI vide.')
  return text
}

/** Traduit un lot de répliques ; renvoie une Map numéro → traduction. */
export async function translateBatch(
  settings: AiSettings,
  srcLang: string,
  tgtLang: string,
  items: TranslateItem[],
  context: ContextPair[],
  signal: AbortSignal,
): Promise<Map<number, string>> {
  const prompt = buildPrompt(srcLang, tgtLang, items, context)
  let text: string
  try {
    text = settings.provider === 'anthropic' ? await callAnthropic(settings, prompt, signal) : await callOpenAi(settings, prompt, signal)
  } catch (err) {
    if (err instanceof AiError) throw err
    if ((err as Error).name === 'AbortError') throw err
    throw new AiError(
      'Impossible de joindre le service de traduction. Vérifiez votre connexion internet (les appels partent directement de votre navigateur).',
    )
  }
  return parseModelJson(text, items)
}

export const BATCH_SIZE = 25
export const CONTEXT_SIZE = 4

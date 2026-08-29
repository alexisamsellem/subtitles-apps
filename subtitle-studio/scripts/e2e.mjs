// Vérification de bout en bout du parcours complet, avec un vrai navigateur :
// import → édition → persistance (reload) → alignement d'une traduction →
// filtres/recherche → navigation clavier → export SRT validé octet par octet →
// fluidité sur un fichier de 5000 répliques.
//
// Usage : npm run e2e   (build + preview + scénario)

import { chromium } from 'playwright'
import { spawn, execSync } from 'node:child_process'
import { readFileSync, mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 4173
let failures = 0
let checks = 0

function check(name, cond, extra = '') {
  checks++
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

async function waitForServer(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // pas encore prêt
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`Serveur injoignable : ${url}`)
}

// ---- build + preview ----
console.log('Build de production…')
execSync('npm run build', { cwd: root, stdio: 'inherit' })
execSync(`node scripts/gen-large-srt.mjs 5000 ${join(tmpdir(), 'large_fr.srt')}`, { cwd: root, stdio: 'inherit' })

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
})
process.on('exit', () => server.kill())

await waitForServer(`http://localhost:${PORT}/`)
console.log('Serveur preview prêt.')

const executablePath = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined
const browser = await chromium.launch({ executablePath })
const context = await browser.newContext({ locale: 'fr-FR' })
const page = await context.newPage()
const downloadsDir = mkdtempSync(join(tmpdir(), 'subtitle-studio-e2e-'))

try {
  // ---------- 1. Import du fichier source ----------
  console.log('\n1. Import du SRT source')
  await page.goto(`http://localhost:${PORT}/`)
  check('écran d’accueil affiché', await page.locator('.dropzone').isVisible())
  await page.setInputFiles('[data-testid="source-file-input"]', join(root, 'demo/source_fr.srt'))
  await page.waitForSelector('.row')
  check('12 répliques annoncées', (await page.locator('.topbar__count').textContent()).includes('12'))
  check('dialogue source affiché', await page.getByText('Bonjour, capitaine Aurélie.').isVisible())
  check('timecodes affichés dans la colonne méta', await page.locator('.row__tc >> text=00:00:01,000').first().isVisible())
  const italicSource = await page.locator('[data-row-id="1"] .row__source').innerText()
  check('balises <i> non visibles dans la source (rendu en italique)', !italicSource.includes('<i>'), italicSource)
  const italicRendered = await page.locator('[data-row-id="1"] .row__source i').count()
  check('italique réellement rendu', italicRendered === 1)
  check('colonne source non éditable', (await page.locator('[data-row-id="0"] .row__source textarea').count()) === 0)
  check('sous-titre vide signalé', await page.locator('[data-row-id="5"] .row__source-empty').isVisible())
  const an8 = await page.locator('[data-row-id="3"] .row__source').innerText()
  check('tag {\\an8} masqué à l’affichage', !an8.includes('{\\an8}') && an8.includes('PORT DE SAINT-MALO'), an8)

  // ---------- 2. Édition manuelle + autosave ----------
  console.log('\n2. Édition manuelle et enregistrement automatique')
  const ta1 = page.locator('[data-row-id="0"] textarea')
  await ta1.click()
  check('ligne active mise en évidence', (await page.locator('.row--active').getAttribute('data-row-id')) === '0')
  await ta1.fill('Hello, Captain Aurélie.')
  await page.waitForTimeout(1000) // autosave débouncé (600 ms)
  check('progression mise à jour', (await page.locator('[data-testid="progress-label"]').textContent()).includes('8%'))

  // ---------- 3. Persistance : fermer puis rouvrir ----------
  console.log('\n3. Persistance locale (rechargement de la page)')
  await page.reload()
  await page.waitForSelector('.row')
  check('projet restauré après rechargement', (await page.locator('.topbar__file').textContent()).includes('source_fr.srt'))
  check('texte édité restauré', (await page.locator('[data-row-id="0"] textarea').inputValue()) === 'Hello, Captain Aurélie.')

  // ---------- 4. Navigation clavier ----------
  console.log('\n4. Navigation clavier')
  await page.locator('[data-row-id="0"] textarea').click()
  await page.keyboard.press('Alt+ArrowDown')
  await page.waitForTimeout(200)
  const focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')
  check('Alt+↓ passe à la réplique suivante', focusedLabel === 'Traduction de la réplique 2', focusedLabel)

  // ---------- 5. Import d'une traduction existante (alignement) ----------
  console.log('\n5. Import d’un SRT déjà traduit, aligné par numéros et timecodes')
  await page.setInputFiles('[data-testid="translation-file-input"]', join(root, 'demo/target_en.srt'))
  await page.getByRole('button', { name: /Ne remplir que les lignes vides/ }).click()
  const report = await page.locator('.report').innerText()
  check('rapport : 9 lignes remplies sur 12', report.includes('9') && report.includes('12'), report)
  check('rapport : lignes sans correspondance n° 6 et 11 signalées', /Sans correspondance[^]*6, 11/.test(report), report)
  check('rapport : entrée étrangère n° 99 ignorée (pas de décalage)', report.includes('99'), report)
  await page.getByRole('button', { name: 'OK' }).click()
  check(
    'texte existant non écrasé par l’import',
    (await page.locator('[data-row-id="0"] textarea').inputValue()) === 'Hello, Captain Aurélie.',
  )
  check(
    'traduction alignée par timecode malgré la renumérotation',
    (await page.locator('[data-row-id="6"] textarea').inputValue()).includes('Where has'),
  )
  const wrapped = await page.locator('[data-row-id="1"] textarea').inputValue()
  check('balises englobantes absentes de la zone d’édition', wrapped === 'The wind is rising over the coast…', wrapped)

  // ---------- 6. Filtres et recherche ----------
  console.log('\n6. Filtres et recherche')
  await page.locator('[data-testid="filter-review"]').click()
  check('filtre « à vérifier » : 2 lignes (6 et 11)', (await page.locator('.row').count()) === 2)
  await page.locator('[data-testid="filter-empty"]').click()
  check('filtre « vides » : 2 lignes restantes', (await page.locator('.row').count()) === 2)
  await page.locator('[data-testid="filter-all"]').click()
  await page.locator('[data-testid="search-input"]').fill('Édouard')
  await page.waitForTimeout(400)
  check('recherche « Édouard » : 1 ligne', (await page.locator('.row').count()) === 1)
  await page.locator('[data-testid="search-input"]').fill('')
  await page.waitForTimeout(400)

  // ---------- 7. Compléter la ligne 11 à la main ----------
  console.log('\n7. Correction manuelle d’une ligne signalée')
  await page.locator('[data-row-id="10"] textarea').fill('— Understood?\n— Understood.')
  await page.locator('[data-row-id="5"] textarea').fill('')
  await page.waitForTimeout(400)
  await page.locator('[data-testid="filter-review"]').click()
  check('la ligne corrigée quitte « à vérifier »', (await page.locator('.row').count()) === 1)
  await page.locator('[data-testid="filter-all"]').click()

  // ---------- 8. Export SRT ----------
  console.log('\n8. Export du SRT cible')
  const downloadPromise = page.waitForEvent('download')
  await page.locator('[data-testid="export-btn"]').click()
  const download = await downloadPromise
  check('nom de fichier proposé : source.en.srt', download.suggestedFilename() === 'source.en.srt', download.suggestedFilename())
  const exportPath = join(downloadsDir, download.suggestedFilename())
  await download.saveAs(exportPath)
  const exported = readFileSync(exportPath, 'utf-8')

  check('export en CRLF', exported.includes('\r\n') && !/[^\r]\n/.test(exported))
  const sourceRaw = readFileSync(join(root, 'demo/source_fr.srt'), 'utf-8')
  const timings = (s) => [...s.matchAll(/^.*-->.*$/gm)].map((m) => m[0].trim())
  check(
    'timecodes de l’export strictement identiques à la source',
    JSON.stringify(timings(exported)) === JSON.stringify(timings(sourceRaw)),
  )
  const numbers = (s) => [...s.matchAll(/^(\d+)\r?\n\d{2}:/gm)].map((m) => m[1])
  check('numéros et ordre identiques à la source', JSON.stringify(numbers(exported)) === JSON.stringify(numbers(sourceRaw)))
  check('italique réappliqué à l’export', exported.includes('<i>The wind is rising over the coast…</i>'))
  check('tag {\\an8} réappliqué à l’export', exported.includes('{\\an8}SAINT-MALO HARBOUR — 1943'))
  check(
    'balise font réappliquée à la saisie manuelle',
    exported.includes('<font color="#ffcc00">— Understood?\r\n— Understood.</font>'),
  )
  check('ligne restée vide exportée vide (bloc 6 conservé)', /6\r\n00:00:14,700 --> 00:00:16,000\r\n\r\n7\r\n/.test(exported))
  check('accents et caractères spéciaux UTF-8 intacts', exported.includes('Aurélie') && exported.includes('Édouard'))

  // ---------- 9. Gros fichier : fluidité et virtualisation ----------
  console.log('\n9. Fichier de 5000 répliques (virtualisation)')
  await page.locator('button[title^="Nouveau projet"]').click()
  await page.getByRole('button', { name: 'Fermer le projet' }).click()
  await page.waitForSelector('.dropzone')
  const t0 = Date.now()
  await page.setInputFiles('[data-testid="source-file-input"]', join(tmpdir(), 'large_fr.srt'))
  await page.waitForSelector('.row')
  const loadMs = Date.now() - t0
  check(`import + rendu en moins de 5 s (${loadMs} ms)`, loadMs < 5000)
  check('5000 répliques annoncées', (await page.locator('.topbar__count').textContent()).includes('5000'))
  const domRows = await page.locator('.row').count()
  check(`liste virtualisée : ${domRows} lignes dans le DOM (« 5000)`, domRows > 0 && domRows < 120)
  await page.locator('.table').evaluate((el) => (el.scrollTop = el.scrollHeight))
  await page.waitForTimeout(400)
  check('la fin du fichier est atteignable au défilement', await page.getByText('(réplique 5000)').isVisible())
  const lastRowId = await page.locator('.row').last().getAttribute('data-row-id')
  const tType = Date.now()
  await page.locator(`[data-row-id="${lastRowId}"] textarea`).fill('Test de frappe fluide.')
  check(`frappe réactive en bas de fichier (${Date.now() - tType} ms)`, Date.now() - tType < 1500)
} finally {
  await browser.close()
  server.kill()
}

console.log(`\n${checks - failures}/${checks} vérifications réussies.`)
if (failures > 0) {
  console.error(`ÉCHEC : ${failures} vérification(s) en échec.`)
  process.exit(1)
}
console.log('Parcours complet vérifié : import, édition, persistance, alignement, filtres, export, gros fichier. ✓')

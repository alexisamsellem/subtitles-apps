// Génère un gros fichier SRT de test (par défaut 5000 répliques).
// Usage : node scripts/gen-large-srt.mjs [nombre] [sortie]
import { writeFileSync } from 'node:fs'

const count = Number(process.argv[2] ?? 5000)
const out = process.argv[3] ?? 'demo/large_fr.srt'

const pad = (n, w) => String(n).padStart(w, '0')
const label = (ms) =>
  `${pad(Math.floor(ms / 3600000), 2)}:${pad(Math.floor((ms % 3600000) / 60000), 2)}:${pad(Math.floor((ms % 60000) / 1000), 2)},${pad(ms % 1000, 3)}`

const phrases = [
  'Qu’est-ce que tu fais là ?',
  'Je n’en sais rien du tout.',
  'Écoute-moi bien, une dernière fois.',
  'Ça ne change rien à l’affaire.',
  'On se retrouve à minuit, quai n°4.',
]

let srt = ''
for (let i = 1; i <= count; i++) {
  const start = i * 2500
  const end = start + 2000
  srt += `${i}\r\n${label(start)} --> ${label(end)}\r\n${phrases[i % phrases.length]} (réplique ${i})\r\n\r\n`
}
writeFileSync(out, srt, 'utf-8')
console.log(`Écrit : ${out} (${count} répliques)`)

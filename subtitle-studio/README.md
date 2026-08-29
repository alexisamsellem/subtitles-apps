# Subtitle Studio

Application web locale pour **traduire et adapter des sous-titres SRT** réplique par réplique,
sans jamais manipuler le format technique du fichier. Inspirée du panneau de transcription de
Premiere Pro : numéros et timecodes dans une colonne étroite, dialogue source verrouillé à gauche,
traduction éditable à droite.

## Lancer l'application

```bash
npm install
npm run dev        # http://localhost:5173
```

Ou en version construite :

```bash
npm run build
npm run preview    # http://localhost:4173
```

## Parcours

1. **Importer** un fichier SRT source (glisser-déposer ou clic). Numéros, timecodes et textes
   sont analysés automatiquement ; les balises de style (`<i>`, `<b>`, `<font>`, `{\an8}`) qui
   enveloppent une réplique sont extraites des zones d'édition et réappliquées à l'export.
2. **Choisir** la langue source et la langue cible (pré-devinées depuis le nom du fichier).
3. **Remplir la colonne cible**, au choix :
   - *Importer une traduction* : un second SRT déjà traduit, aligné en priorité par numéros et
     timecodes. Les écarts (renumérotation, lignes manquantes, lignes étrangères) sont signalés
     dans un rapport et marqués « à vérifier » — jamais écrasés ni décalés silencieusement.
   - *Traduire par IA* : Anthropic (Claude) ou OpenAI, au choix, avec une clé API saisie dans
     l'interface et conservée **uniquement dans ce navigateur**. La traduction se fait par lots,
     avec le contexte des répliques précédentes (ton, noms propres, continuité, longueur de
     lecture). Seules les lignes vides sont remplies, et elles sont marquées « à vérifier ».
   - *Saisie manuelle* : commencer avec une colonne vide.
4. **Réviser** : ligne active surlignée, champs multi-lignes auto-redimensionnés, enregistrement
   automatique, recherche, filtres (vides / à vérifier / modifiées), indicateur de progression.
5. **Exporter** un SRT valide (UTF-8, CRLF) qui préserve **exactement** les numéros, l'ordre et
   les timecodes du fichier source, avec les textes de la colonne cible.

Le projet en cours est enregistré automatiquement dans le navigateur (localStorage) : fermez
l'onglet, rouvrez-le, votre travail est restauré.

## Raccourcis clavier

| Raccourci | Action |
|---|---|
| `Alt + ↓` / `Alt + ↑` | Réplique suivante / précédente |
| `Ctrl/⌘ + Entrée` | Valider et passer à la suivante |
| `Ctrl/⌘ + K` | Rechercher |
| `Ctrl/⌘ + S` | Exporter le SRT traduit |

## Traduction par IA — limite explicite

L'intégration IA est complète (fournisseurs interchangeables, lots contextuels, progression,
annulation, erreurs lisibles) mais nécessite **une clé API que vous êtes seul à pouvoir fournir**
(Anthropic `sk-ant-…` ou OpenAI `sk-…`). L'interface l'indique clairement ; sans clé, tout le
reste de l'application fonctionne normalement. La clé ne quitte jamais votre navigateur, hormis
les appels directs au fournisseur choisi.

## Fichiers de démonstration

- `demo/source_fr.srt` — 12 répliques en français : accents, dialogues multi-lignes, italiques,
  balise `<b>` en milieu de phrase, `<font color>`, tag de position `{\an8}`, sous-titre vide.
- `demo/target_en.srt` — traduction anglaise volontairement imparfaite (renumérotée, une ligne
  manquante, une ligne étrangère) pour tester le rapport d'alignement.
- `node scripts/gen-large-srt.mjs 5000` — génère un gros fichier pour éprouver la fluidité
  (la liste est virtualisée : elle reste fluide de 10 à 5000+ répliques).

## Vérifications

```bash
npm test       # 34 tests unitaires : parseur SRT, balises, alignement
npm run e2e    # parcours complet dans un vrai navigateur (38 vérifications) :
               # import → édition → persistance → alignement → filtres → export → 5000 lignes
```

## Cas gérés

UTF-8 (et repli windows-1252 pour les vieux fichiers), BOM, CRLF, accents et caractères
spéciaux, dialogues multi-lignes, sous-titres vides, millisecondes en point, blocs sans numéro,
blocs collés, fichiers WebVTT refusés avec un message clair, fichiers invalides expliqués en
français, balises de style préservées sans édition manuelle.

## Stack

Vite + React + TypeScript, `@tanstack/react-virtual` pour la virtualisation, zéro backend :
tout est local. Tests : Vitest + Playwright.

## Hors périmètre (volontairement)

Comptes, collaboration, paiement, édition des timecodes, formats autres que SRT.

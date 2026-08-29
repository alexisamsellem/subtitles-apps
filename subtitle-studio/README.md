# Subtitle Studio

A local web app for **translating and adapting SRT subtitles** line by line, without ever touching
the technical format of the file. Inspired by Premiere Pro's transcript panel: numbers and timecodes
in a narrow column, the read-only source dialogue on the left, the editable translation on the right.

Everything runs in your browser. No account, no server, no upload.

> **Note:** the application interface is in French.

## Running the app

```bash
npm install
npm run dev        # http://localhost:5173
```

Or the production build:

```bash
npm run build
npm run preview    # http://localhost:4173
```

## Walkthrough

1. **Import** a source SRT file (drag and drop, or click). Numbers, timecodes and text are parsed
   automatically. Style tags that wrap a whole line (`<i>`, `<b>`, `<font>`, `{\an8}`) are lifted
   out of the editing fields and reapplied on export, so you never edit markup by hand.
2. **Pick** the source and target languages (guessed from the file name).
3. **Fill the target column**, in any of three ways:
   - *Import a translation*: a second, already-translated SRT, aligned primarily by subtitle numbers
     and timecodes. Mismatches (renumbering, missing lines, extra lines) are listed in a report and
     flagged "to check" — never overwritten or silently shifted.
   - *Translate with AI*: Anthropic (Claude) or OpenAI, with an API key entered in the interface and
     kept **in your browser only**. Translation runs in batches with the context of preceding lines,
     to preserve tone, proper nouns, continuity and a readable length. Only empty lines are filled,
     and each one is flagged "to check".
   - *Type it yourself*: start from an empty target column.
4. **Review**: the active line is highlighted, target fields are multi-line and auto-resizing, edits
   save automatically. Search, filters (empty / to check / edited) and a progress indicator help you
   move through long files.
5. **Export** a valid SRT (UTF-8, CRLF) that preserves the source file's numbers, order and timecodes
   **exactly**, using only the text from the target column.

The current project is saved automatically in the browser (localStorage): close the tab, reopen it,
and your work is restored.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Alt + ↓` / `Alt + ↑` | Next / previous line |
| `Ctrl/⌘ + Enter` | Confirm and move to the next line |
| `Ctrl/⌘ + K` | Search |
| `Ctrl/⌘ + S` | Export the translated SRT |

## AI translation — an explicit limit

The AI integration is complete (interchangeable providers, contextual batching, progress, cancel,
readable errors) but needs **an API key that only you can supply** (Anthropic `sk-ant-…` or OpenAI
`sk-…`). The interface states this plainly, and without a key everything else works normally. The key
never leaves your browser, apart from the direct calls to the provider you choose.

## Demo files

- `demo/source_fr.srt` — 12 French lines covering accents, multi-line dialogue, italics, a mid-sentence
  `<b>` tag, `<font color>`, an `{\an8}` position tag, and an empty subtitle.
- `demo/target_en.srt` — a deliberately imperfect English translation (renumbered, one line missing,
  one extra line) to exercise the alignment report.
- `node scripts/gen-large-srt.mjs 5000` — generates a large file to test responsiveness. The list is
  virtualised, so it stays fluid from 10 to 5000+ lines.

## Verification

```bash
npm test       # 34 unit tests: SRT parser, style tags, alignment
npm run e2e    # full journey in a real browser (38 checks):
               # import → editing → persistence → alignment → filters → export → 5000 lines
```

## Handled cases

UTF-8 (with a windows-1252 fallback for older files), BOM, CRLF, accents and special characters,
multi-line dialogue, empty subtitles, milliseconds written with a dot, blocks with no number, blocks
run together without a blank line, WebVTT files rejected with a clear message, invalid files explained
in plain language, and useful style tags preserved without manual editing.

## Stack

Vite + React + TypeScript, `@tanstack/react-virtual` for list virtualisation, no backend — everything
is local. Tests: Vitest + Playwright.

## Out of scope (deliberately)

Accounts, collaboration, payment, timecode editing, and subtitle formats other than SRT.

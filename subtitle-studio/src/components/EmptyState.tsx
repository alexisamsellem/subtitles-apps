import { useRef, useState } from 'react'

interface EmptyStateProps {
  onFile: (file: File) => void
}

export function EmptyState({ onFile }: EmptyStateProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  return (
    <div className="empty">
      <div className="empty__card">
        <h1 className="empty__title">Subtitle Studio</h1>
        <p className="empty__sub">
          Traduisez et adaptez vos sous-titres réplique par réplique, sans jamais toucher au format
          technique. Les timecodes d’origine sont préservés à l’export.
        </p>

        <div
          className={`dropzone${dragging ? ' dropzone--over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            const file = e.dataTransfer.files?.[0]
            if (file) onFile(file)
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        >
          <div className="dropzone__icon">⬆</div>
          <p><strong>Déposez votre fichier SRT source ici</strong></p>
          <p className="dropzone__hint">ou cliquez pour choisir un fichier (.srt, UTF-8 recommandé)</p>
          <input
            ref={inputRef}
            type="file"
            accept=".srt,text/plain,application/x-subrip"
            hidden
            data-testid="source-file-input"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onFile(file)
              e.target.value = ''
            }}
          />
        </div>

        <ol className="empty__steps">
          <li>Importez le fichier SRT dans la langue source — numéros, timecodes et dialogues sont analysés automatiquement.</li>
          <li>Remplissez la colonne cible : import d’un SRT déjà traduit, traduction par IA (clé optionnelle), ou saisie manuelle.</li>
          <li>Relisez ligne à ligne, puis exportez un SRT valide avec exactement la synchronisation d’origine.</li>
        </ol>
        <p className="empty__note">
          Tout reste sur votre machine : votre travail est enregistré automatiquement dans ce navigateur
          et retrouvé à la prochaine ouverture.
        </p>
      </div>
    </div>
  )
}

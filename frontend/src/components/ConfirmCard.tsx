import { Download } from 'lucide-react'
import { audioSrc } from '../api'
import { cardSide, shortLang } from '../lib'
import type { Card } from '../types'
import PlayButton from './PlayButton'

const SIDES = [
  { speaker: 'seller', lang: 'gu', name: 'Gujarati' },
  { speaker: 'buyer', lang: 'hi', name: 'Hindi' },
] as const

export default function ConfirmCard({ card, play }: { card: Card; play: (url: string) => void }) {
  const sides = SIDES.map((s) => ({ ...s, side: cardSide(card, s.speaker) }))
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(card, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'pakka-terms.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section aria-labelledby="card-title" className="rounded-panel border-2 border-ok bg-ok-soft p-6">
      <h2 id="card-title" className="text-2xl">
        Terms confirmed
      </h2>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        {sides.map(({ lang, name, side }) => (
          <div key={lang} lang={shortLang(lang)}>
            <h3 className="text-lg">{name}</h3>
            {side ? (
              <ul className="mt-2 space-y-1">
                {side.lines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-muted">This language is missing from the card. Use Download JSON.</p>
            )}
            <div className="mt-3">
              <PlayButton url={side?.audioUrl ? audioSrc(side.audioUrl) : null} label={`Play ${name}`} play={play} />
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="btn mt-6" onClick={download}>
        <Download size={18} aria-hidden="true" />
        Download JSON
      </button>
    </section>
  )
}

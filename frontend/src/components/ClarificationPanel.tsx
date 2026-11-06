import { useEffect, useRef } from 'react'
import { SkipForward } from 'lucide-react'
import { SLOT_LABEL, SPEAKERS, shortLang } from '../lib'
import type { Clarification, Speaker } from '../types'
import PlayButton from './PlayButton'

interface Props {
  clarification: Clarification
  speaker: Speaker
  busy: boolean
  error?: string
  audioUrl: string | null
  play: (url: string) => void
  onAnswer: (answer: { optionId: string } | { skip: true }) => void
}

export default function ClarificationPanel({ clarification: c, speaker, busy, error, audioUrl, play, onAnswer }: Props) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => ref.current?.focus(), [c])
  const who = SPEAKERS[speaker]

  return (
    <section
      ref={ref}
      tabIndex={-1}
      role="group"
      aria-labelledby="clarify-title"
      aria-describedby="clarify-question"
      className="rounded-panel border-2 border-accent bg-accent-soft p-6 sm:p-8"
    >
      <h2 id="clarify-title" className="text-lg text-muted">
        Held until {who.title.toLowerCase()} answers: {SLOT_LABEL[c.slot].toLowerCase()}
      </h2>
      <div>
        <p id="clarify-question" lang={shortLang(c.question.lang)} className="mt-3 max-w-prose font-display text-2xl sm:text-3xl">
          {c.question.text}
        </p>
        {c.quote && (
          <blockquote lang={who.lang} className="mt-4 max-w-prose border-l-4 border-line pl-4 text-muted">
            You said: <q>{c.quote}</q>
          </blockquote>
        )}
      </div>

      <ul className="mt-6 flex flex-wrap gap-3">
        {c.options.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              className="btn btn-primary text-lg"
              lang={shortLang(c.question.lang)}
              disabled={busy}
              onClick={() => onAnswer({ optionId: o.id })}
            >
              {o.label}
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="btn text-lg" disabled={busy} onClick={() => onAnswer({ skip: true })}>
            <SkipForward size={18} aria-hidden="true" />
            Skip
          </button>
        </li>
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <PlayButton url={audioUrl} label="Play question again" play={play} />
        <p className="text-muted">You can also answer by voice or text in the {who.title.toLowerCase()} panel.</p>
      </div>
      {error && (
        <p className="note-error mt-4" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

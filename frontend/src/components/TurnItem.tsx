import { Pause, Send } from 'lucide-react'
import { SPEAKERS, shortLang } from '../lib'
import { turnAudioUrl } from '../api'
import type { Turn } from '../types'
import PlayButton from './PlayButton'

const ms = (n?: number | null) => (typeof n === 'number' ? `${Math.round(n)} ms` : 'none')

export default function TurnItem({ turn, play }: { turn: Turn; play: (url: string) => void }) {
  const who = SPEAKERS[turn.speaker]
  const held = turn.status === 'held'
  const url = turnAudioUrl(turn)
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-lg">{who.title}</h3>
        <span className={`inline-flex items-center gap-1.5 font-semibold ${held ? 'text-warn' : 'text-ok'}`}>
          {held ? <Pause size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
          {held ? 'Held' : 'Sent'}
        </span>
        <span className="text-muted">{turn.source === 'voice' ? 'Voice' : 'Typed'}</span>
      </div>
      <p lang={shortLang(turn.lang || who.lang)} className="mt-2 max-w-prose text-lg">
        {turn.transcript}
      </p>
      <p lang={SPEAKERS[who.other].lang} className="mt-1 max-w-prose text-muted">
        {turn.translation}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <dl className="flex flex-wrap gap-x-4 text-muted">
          <div className="flex gap-1">
            <dt>Speech to text</dt>
            <dd>{ms(turn.latency?.sttMs)}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Translation</dt>
            <dd>{ms(turn.latency?.llmMs)}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Speech out</dt>
            <dd>{ms(turn.latency?.ttsMs)}</dd>
          </div>
        </dl>
        {!held && <PlayButton url={url} label="Play audio" play={play} />}
      </div>
    </li>
  )
}

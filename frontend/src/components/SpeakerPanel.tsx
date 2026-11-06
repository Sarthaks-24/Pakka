import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { Mic, Send } from 'lucide-react'
import { blobToWav } from '../audio/wav'
import { micDenied, startRecorder, type Recorder } from '../audio/record'
import { SPEAKERS } from '../lib'
import type { Speaker } from '../types'

const MAX_MS = 25000
const MIN_MS = 500
const now = () => performance.now()

interface Props {
  speaker: Speaker
  disabled: boolean
  disabledReason?: string
  answering: boolean
  error?: string
  onAudio: (wav: Blob) => Promise<boolean>
  onText: (text: string) => Promise<boolean>
}

export default function SpeakerPanel({ speaker, disabled, disabledReason, answering, error, onAudio, onText }: Props) {
  const { title, language, lang } = SPEAKERS[speaker]
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'processing'>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [message, setMessage] = useState('')
  const [text, setText] = useState('')
  const held = useRef(false)
  const recorder = useRef<Recorder | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const lastHold = useRef(-Infinity)

  useEffect(
    () => () => {
      held.current = false
      window.clearInterval(timer.current)
      const rec = recorder.current
      recorder.current = null
      if (rec) void rec.stop()
    },
    [],
  )

  async function press() {
    if (disabled || held.current || phase !== 'idle') return
    held.current = true
    setMessage('')
    setPhase('starting')
    let rec: Recorder
    try {
      rec = await startRecorder()
    } catch (e) {
      held.current = false
      setPhase('idle')
      setMessage(
        micDenied(e)
          ? 'Microphone access is blocked. Allow it in the browser address bar, or use Type instead below.'
          : 'No microphone was found or it could not start. Use Type instead below.',
      )
      return
    }
    if (!held.current) {
      await rec.stop()
      setPhase('idle')
      setMessage('Too short. Hold the button for at least half a second.')
      return
    }
    recorder.current = rec
    const startedAt = now()
    setElapsed(0)
    setPhase('recording')
    timer.current = window.setInterval(() => {
      const ms = now() - startedAt
      setElapsed(Math.min(ms, MAX_MS))
      if (ms >= MAX_MS) void release()
    }, 100)
  }

  async function release() {
    if (!held.current) return
    held.current = false
    window.clearInterval(timer.current)
    const rec = recorder.current
    if (!rec) return
    recorder.current = null
    const { blob, ms } = await rec.stop()
    if (ms < MIN_MS) {
      setPhase('idle')
      setMessage('Too short. Hold the button for at least half a second.')
      return
    }
    setPhase('processing')
    try {
      await onAudio(await blobToWav(blob))
    } catch {
      setMessage('This browser could not read the recording. Use Type instead below.')
    }
    setPhase('idle')
  }

  const keyDown = (e: KeyboardEvent) => {
    if (e.key !== ' ' && e.key !== 'Enter') return
    e.preventDefault()
    if (!e.repeat) void press()
  }
  const keyUp = (e: KeyboardEvent) => {
    if (e.key !== ' ' && e.key !== 'Enter') return
    e.preventDefault()
    void release()
  }
  // Screen readers send only a click. A click that follows a pointer hold is ignored.
  const click = () => {
    if (now() - lastHold.current < 500) return
    if (phase === 'idle') void press()
    else if (phase === 'recording') void release()
  }
  const pointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    lastHold.current = now()
    e.currentTarget.setPointerCapture(e.pointerId)
    void press()
  }

  const recording = phase === 'recording'
  const left = Math.ceil((MAX_MS - elapsed) / 1000)
  const status = phase === 'recording' ? `Recording, ${MAX_MS / 1000} seconds left` : phase === 'processing' ? 'Sending' : ''
  const blocked = disabled || phase === 'processing'

  async function submitText(e: React.FormEvent) {
    e.preventDefault()
    const value = text.trim()
    if (!value || blocked) return
    if (await onText(value)) setText('')
  }

  return (
    <section aria-labelledby={`${speaker}-title`} className="rounded-panel border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={`${speaker}-title`} className="text-xl">
          {title}
        </h2>
        <p className="text-muted">
          Speaks <span lang={lang}>{language}</span>
        </p>
      </div>

      <button
        type="button"
        className={`btn mt-4 min-h-20 w-full select-none text-lg ${recording ? 'btn-primary' : ''}`}
        style={{ touchAction: 'none' }}
        disabled={blocked}
        aria-pressed={recording}
        onPointerDown={pointerDown}
        onClick={click}
        onPointerUp={() => {
          lastHold.current = now()
          void release()
        }}
        onPointerCancel={() => void release()}
        onKeyDown={keyDown}
        onKeyUp={keyUp}
        onBlur={() => void release()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Mic size={22} aria-hidden="true" />
        {phase === 'processing' ? 'Sending' : recording ? `Release to send, ${left} s left` : 'Hold to talk'}
      </button>
      <div className="mt-2 h-1.5 rounded-control bg-accent-soft" aria-hidden="true">
        <div className="h-full rounded-control bg-accent" style={{ width: `${(elapsed / MAX_MS) * 100}%` }} />
      </div>
      <p className="mt-2 text-muted">Press and hold, or hold Space or Enter while this button is focused. With a screen reader, activate once to start and again to send. Up to 25 seconds.</p>
      <div role="status" className="sr-only">
        {status}
      </div>

      <div aria-live="polite" className="mt-2 space-y-2">
        {disabledReason && disabled && <p className="text-muted">{disabledReason}</p>}
        {answering && <p className="font-semibold">Answer the question below, or speak again.</p>}
        {message && <p className="note-error">{message}</p>}
        {error && <p className="note-error">{error}</p>}
      </div>

      <form onSubmit={submitText} className="mt-4 border-t border-line pt-4">
        <label htmlFor={`${speaker}-text`} className="font-semibold">
          Type instead
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id={`${speaker}-text`}
            className="field"
            lang={lang}
            value={text}
            disabled={blocked}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Write in ${language}`}
          />
          <button type="submit" className="btn" disabled={blocked || !text.trim()}>
            <Send size={18} aria-hidden="true" />
            Send text
          </button>
        </div>
      </form>
    </section>
  )
}

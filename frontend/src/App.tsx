import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleCheck, Moon, Plus, ServerOff, Sun } from 'lucide-react'
import * as api from './api'
import { SLOT_LABEL } from './lib'
import type { Card, Clarification, Session, SlotName, Speaker, TurnResult } from './types'
import ClarificationPanel from './components/ClarificationPanel'
import ConfirmCard from './components/ConfirmCard'
import LedgerPanel from './components/LedgerPanel'
import Replay from './components/Replay'
import SpeakerPanel from './components/SpeakerPanel'
import TurnItem from './components/TurnItem'

type Where = Speaker | 'clarify' | 'confirm' | 'audio'
type Theme = 'light' | 'dark'

const readTheme = (): Theme | null => {
  try {
    const v = localStorage.getItem('pakka-theme')
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}
const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches

export default function App() {
  const [mode, setMode] = useState<'live' | 'replay'>('live')
  const [theme, setTheme] = useState<Theme | null>(readTheme)
  const [health, setHealth] = useState<'checking' | 'up' | 'down'>('checking')
  const [session, setSession] = useState<Session | null>(null)
  const [clar, setClar] = useState<Clarification | null>(null)
  const [pending, setPending] = useState<Speaker | null>(null)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<Where, string>>>({})
  const [card, setCard] = useState<Card | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)

  const setError = (where: Where, message = '') => setErrors((e) => ({ ...e, [where]: message }))

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme
    else delete document.documentElement.dataset.theme
  }, [theme])

  const checkServer = useCallback(() => {
    api
      .checkHealth()
      .then(() => setHealth('up'))
      .catch(() => setHealth('down'))
  }, [])
  useEffect(checkServer, [checkServer])

  const play = useCallback((url: string, auto = false) => {
    audio.current?.pause()
    const el = (audio.current = new Audio(api.audioSrc(url)))
    el.play().catch(() => {
      if (!auto) setError('audio', 'This browser blocked or could not play the audio. Press play again.')
    })
  }, [])

  function toggleTheme() {
    const next: Theme = (theme ?? (systemDark() ? 'dark' : 'light')) === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try {
      localStorage.setItem('pakka-theme', next)
    } catch {
      /* storage can be blocked; the theme still applies for this visit */
    }
  }

  function applyResult(r: TurnResult) {
    setSession(r.session)
    if (r.outcome === 'clarify' && r.clarification) {
      setClar(r.clarification)
      setPending(r.turn.speaker)
      if (r.clarification.audioUrl) play(r.clarification.audioUrl, true)
    } else {
      setClar(null)
      setPending(null)
      if (r.release?.audioUrl) play(r.release.audioUrl, true)
    }
  }

  async function run(where: Where, action: () => Promise<void>): Promise<boolean> {
    setBusy(true)
    setErrors({})
    try {
      await action()
      return true
    } catch (e) {
      setError(where, (e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const ensureSession = async () => session ?? (await api.createSession())

  const sendTurn = (speaker: Speaker, input: { wav: Blob } | { text: string }) =>
    run(speaker, async () => {
      const s = await ensureSession()
      setSession(s)
      applyResult(await api.sendTurn(s.id, speaker, input))
    })

  const answer = (a: { optionId: string } | { skip: true }) =>
    run('clarify', async () => {
      if (session) applyResult(await api.clarify(session.id, a))
    })

  const confirm = () =>
    run('confirm', async () => {
      if (!session) return
      try {
        const r = await api.confirmDeal(session.id)
        setSession(r.session)
        setCard(r.card)
      } catch (e) {
        if (e instanceof api.ApiError && e.status === 409) {
          const names = (e.missing ?? []).map((m) => SLOT_LABEL[m as SlotName]?.toLowerCase() ?? m)
          throw new Error(
            `${e.message}${names.length ? ` Still open: ${names.join(', ')}.` : ''} Say or type those terms, then press Confirm deal again.`,
          )
        }
        throw e
      }
    })

  function newDeal() {
    audio.current?.pause()
    setSession(null)
    setClar(null)
    setPending(null)
    setCard(null)
    setErrors({})
    setMode('live')
  }

  const down = health === 'down'
  const disabledFor = (s: Speaker) => busy || down || !!card || (!!pending && pending !== s)
  const reasonFor = (s: Speaker) =>
    down ? 'Server not reachable.' : card ? 'The deal is confirmed. Start a new deal to talk again.' : pending && pending !== s ? `Waiting for the ${pending} to answer.` : undefined
  const turns = session?.turns ?? []
  const effectiveDark = (theme ?? (systemDark() ? 'dark' : 'light')) === 'dark'

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl">Pakka</h1>
          <p className="mt-1 max-w-prose text-muted">
            A Gujarati seller and a Hindi buyer talk by voice. Pakka holds any unclear price, quantity or date until the speaker settles it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="View" className="flex">
            {(['live', 'replay'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                className={`btn first:rounded-r-none last:rounded-l-none ${mode === m ? 'btn-primary' : ''}`}
                onClick={() => setMode(m)}
              >
                {m === 'live' ? 'Live' : 'Replay'}
              </button>
            ))}
          </div>
          <button type="button" className="btn" onClick={newDeal}>
            <Plus size={18} aria-hidden="true" />
            New deal
          </button>
          <button type="button" className="btn" onClick={toggleTheme}>
            {effectiveDark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
            {effectiveDark ? 'Light theme' : 'Dark theme'}
          </button>
        </div>
      </header>

      {down && (
        <div className="note-error mt-6 flex flex-wrap items-center gap-3" role="alert">
          <ServerOff size={20} aria-hidden="true" />
          <p className="flex-1">Server not reachable at {api.API_URL}. Start the backend, then press Retry.</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setHealth('checking')
              checkServer()
            }}
          >
            Retry
          </button>
        </div>
      )}

      <main className="mt-8">
        {mode === 'replay' ? (
          <Replay play={play} />
        ) : (
          <div className="space-y-8">
            <div className="grid gap-6 md:grid-cols-2">
              {(['seller', 'buyer'] as const).map((s) => (
                <SpeakerPanel
                  key={s}
                  speaker={s}
                  disabled={disabledFor(s)}
                  disabledReason={reasonFor(s)}
                  answering={pending === s}
                  error={errors[s]}
                  onAudio={(wav) => sendTurn(s, { wav })}
                  onText={(text) => sendTurn(s, { text })}
                />
              ))}
            </div>
            {errors.audio && <p className="note-error">{errors.audio}</p>}

            {clar && pending && (
              <ClarificationPanel
                clarification={clar}
                speaker={pending}
                busy={busy}
                error={errors.clarify}
                audioUrl={clar.audioUrl ? api.audioSrc(clar.audioUrl) : null}
                play={play}
                onAnswer={answer}
              />
            )}

            {card && <ConfirmCard card={card} play={play} />}

            <div className="grid gap-10 lg:grid-cols-[1fr_24rem]">
              <section aria-labelledby="log-title">
                <h2 id="log-title" className="text-xl">
                  Conversation
                </h2>
                {turns.length === 0 ? (
                  <p className="mt-3 max-w-prose text-muted">
                    Nothing said yet. Hold a talk button and speak, or type a message. Each turn shows what was heard, the translation and how long each step took.
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-line border-y border-line">
                    {turns.map((t, i) => (
                      <TurnItem key={i} turn={t} play={play} />
                    ))}
                  </ul>
                )}
              </section>

              <div className="space-y-6">
                <LedgerPanel ledger={session?.ledger} />
                {!card && (
                  <div>
                    <button type="button" className="btn btn-primary w-full" disabled={busy || down || !session || !!pending} onClick={() => void confirm()}>
                      <CircleCheck size={18} aria-hidden="true" />
                      Confirm deal
                    </button>
                    <p className="mt-2 text-muted">Available once every term is clear and no question is open.</p>
                    {errors.confirm && (
                      <p className="note-error mt-3" role="alert">
                        {errors.confirm}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

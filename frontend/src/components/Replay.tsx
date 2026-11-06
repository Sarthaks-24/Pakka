import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, History } from 'lucide-react'
import { getSession, listSessions } from '../api'
import type { Session, SessionSummary } from '../types'
import LedgerPanel from './LedgerPanel'
import TurnItem from './TurnItem'

export default function Replay({ play }: { play: (url: string) => void }) {
  const [list, setList] = useState<SessionSummary[] | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    listSessions()
      .then(setList)
      .catch((e: Error) => setError(e.message))
  }, [])

  async function open(id: string) {
    setError('')
    try {
      setSession(await getSession(id))
      setStep(0)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const turns = session?.turns ?? []
  const turn = turns[step]

  return (
    <div className="space-y-6">
      <p className="flex items-center gap-2 rounded-control border-2 border-warn bg-warn-soft px-4 py-3 font-semibold text-warn" role="status">
        <History size={20} aria-hidden="true" />
        Replay. This is a stored session, not a live call.
      </p>
      {error && <p className="note-error">{error} Switch to Live and check the server, then open Replay again.</p>}

      <div className="grid gap-8 lg:grid-cols-[18rem_1fr]">
        <section aria-labelledby="sessions-title">
          <h2 id="sessions-title" className="text-xl">
            Recent sessions
          </h2>
          {list && list.length === 0 && <p className="mt-3 text-muted">No sessions yet. Run a deal in Live and it will appear here.</p>}
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {list?.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="flex min-h-11 w-full cursor-pointer flex-col px-2 py-2 text-left hover:bg-accent-soft aria-[current=true]:bg-accent-soft"
                  aria-current={session?.id === s.id}
                  onClick={() => void open(s.id)}
                >
                  <span className="font-semibold">{new Date(s.createdAt).toLocaleString()}</span>
                  <span className="text-muted">
                    {s.turnCount} turns, {s.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="steps-title">
          <h2 id="steps-title" className="text-xl">
            Turns
          </h2>
          {!session && <p className="mt-3 text-muted">Choose a session to step through its turns.</p>}
          {session && turns.length === 0 && <p className="mt-3 text-muted">This session has no turns.</p>}
          {turn && (
            <>
              <div className="mt-3 flex items-center gap-3">
                <button type="button" className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}>
                  <ChevronLeft size={18} aria-hidden="true" />
                  Previous
                </button>
                <button type="button" className="btn" disabled={step >= turns.length - 1} onClick={() => setStep(step + 1)}>
                  Next
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
                <p aria-live="polite">
                  Turn {step + 1} of {turns.length}
                </p>
              </div>
              <ul className="border-b border-line">
                <TurnItem turn={turn} play={play} />
              </ul>
              <div className="mt-6">
                <LedgerPanel ledger={session?.ledger} />
                <p className="mt-2 text-muted">Final terms of this session.</p>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

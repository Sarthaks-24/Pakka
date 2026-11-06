import type { Card, Session, SessionSummary, Speaker, TurnResult } from './types'

export const API_URL: string = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '')

export class ApiError extends Error {
  status: number
  missing?: string[]
  constructor(status: number, message: string, missing?: string[]) {
    super(message)
    this.status = status
    this.missing = missing
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, init)
  } catch {
    throw new ApiError(0, `Server not reachable at ${API_URL}. Start the backend, then try again.`)
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const message = typeof body?.error === 'string' ? body.error : `The server answered with status ${res.status}. Try again.`
    throw new ApiError(res.status, message, Array.isArray(body?.missing) ? body.missing : undefined)
  }
  return body as T
}

const json = (method: string, data?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: data === undefined ? undefined : JSON.stringify(data),
})

export const checkHealth = () => request<{ ok: boolean }>('/api/health')
export const createSession = () => request<Session>('/api/sessions', json('POST'))
export const listSessions = () => request<SessionSummary[]>('/api/sessions')
export const getSession = (id: string) => request<Session>(`/api/sessions/${id}`)

export function sendTurn(id: string, speaker: Speaker, input: { wav: Blob } | { text: string }) {
  if ('wav' in input) {
    const form = new FormData()
    form.append('speaker', speaker)
    form.append('audio', input.wav, 'turn.wav')
    return request<TurnResult>(`/api/sessions/${id}/turns`, { method: 'POST', body: form })
  }
  return request<TurnResult>(`/api/sessions/${id}/turns`, json('POST', { speaker, text: input.text }))
}

export const clarify = (id: string, answer: { optionId: string } | { skip: true }) =>
  request<TurnResult>(`/api/sessions/${id}/clarify`, json('POST', answer))

export const confirmDeal = (id: string) =>
  request<{ session: Session; card: Card }>(`/api/sessions/${id}/confirm`, json('POST'))

/** Turns a relative audio path from the server into a full URL. */
export const audioSrc = (url: string) => (/^https?:/.test(url) ? url : `${API_URL}${url}`)

export const turnAudioUrl = (t: { audioUrl?: string; audioHash?: string }) =>
  t.audioUrl ? audioSrc(t.audioUrl) : t.audioHash ? `${API_URL}/api/audio/${t.audioHash}` : null

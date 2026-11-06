export type Speaker = 'seller' | 'buyer'
export type SlotName = 'quantity' | 'product' | 'price' | 'delivery' | 'payment'
export type SlotStatus = 'empty' | 'ok' | 'ambiguous' | 'unresolved'

export const SLOTS: SlotName[] = ['quantity', 'product', 'price', 'delivery', 'payment']

export type Slot = { status: SlotStatus; rounds?: number } & Record<string, unknown>
export type Ledger = Partial<Record<SlotName, Slot>>

export interface Turn {
  speaker: Speaker
  lang: string
  source: 'voice' | 'text'
  transcript: string
  translation: string
  status: 'held' | 'released'
  releasedText?: string
  audioHash?: string
  audioUrl?: string
  latency?: { sttMs?: number | null; llmMs?: number | null; ttsMs?: number | null }
}

export interface Session {
  id: string
  createdAt?: string
  status?: string
  turns: Turn[]
  ledger: Ledger
  card?: Card | null
}

export interface SessionSummary {
  id: string
  createdAt: string
  status: string
  turnCount: number
}

export interface Clarification {
  ambiguityId: string
  slot: SlotName
  type: string
  quote?: string
  question: { text: string; lang: string }
  options: { id: string; label: string }[]
  audioUrl?: string
}

export interface TurnResult {
  session: Session
  turn: Turn
  outcome: 'clarify' | 'released'
  clarification?: Clarification
  release?: { text: string; lang: string; audioUrl?: string }
}

/** The card shape is owned by the backend; the card view reads it defensively. */
export interface Card {
  terms: Record<string, unknown>
  text: Partial<Record<'seller' | 'buyer', string>>
  audioUrl: Partial<Record<'seller' | 'buyer', string>>
  confirmedAt: string
}

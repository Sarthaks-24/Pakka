import type { Card, Slot, SlotName, SlotStatus, Speaker } from './types'

export const SPEAKERS: Record<Speaker, { title: string; language: string; lang: string; other: Speaker }> = {
  seller: { title: 'Seller', language: 'Gujarati', lang: 'gu', other: 'buyer' },
  buyer: { title: 'Buyer', language: 'Hindi', lang: 'hi', other: 'seller' },
}

const LANG_NAMES: Record<string, string> = { gu: 'Gujarati', hi: 'Hindi', en: 'English' }
export const shortLang = (code: string) => code.split('-')[0]
export const langName = (code: string) => LANG_NAMES[shortLang(code)] ?? code

export const SLOT_LABEL: Record<SlotName, string> = {
  quantity: 'Quantity',
  product: 'Product',
  price: 'Price',
  delivery: 'Delivery',
  payment: 'Payment',
}

export const STATUS_LABEL: Record<SlotStatus, string> = {
  empty: 'Not stated',
  ok: 'Clear',
  ambiguous: 'Needs an answer',
  unresolved: 'Left unresolved',
}

const str = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v))
const join = (parts: (string | null)[], sep = ' ') => parts.filter(Boolean).join(sep) || null

/** One-line readable value for a ledger slot, or null when nothing is known yet. */
export function formatSlot(name: SlotName, s: Slot | undefined): string | null {
  if (!s) return null
  switch (name) {
    case 'quantity':
      return join([str(s.value), str(s.unit)])
    case 'product':
      return join([str(s.name), str(s.spec)])
    case 'price': {
      const amount = join([str(s.amount), str(s.currency)])
      return amount && join([amount, s.per ? `per ${s.per}` : null, s.gst ? `GST ${s.gst}` : null], ', ')
    }
    case 'delivery':
      return str(s.date) ?? str(s.raw)
    case 'payment':
      return join([s.advancePct != null ? `${s.advancePct}% advance` : null, str(s.balance) && `balance ${s.balance}`], ', ')
  }
}

export interface CardSide {
  lines: string[]
  audioUrl?: string
}

/** One side of the confirmed card. The backend keys `text` and `audioUrl` by speaker. */
export function cardSide(card: Card, speaker: 'seller' | 'buyer'): CardSide | null {
  const text = card.text?.[speaker]
  return text ? { lines: text.split('\n').filter(Boolean), audioUrl: card.audioUrl?.[speaker] } : null
}

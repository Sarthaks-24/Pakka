import { Check, Circle, CircleHelp, TriangleAlert } from 'lucide-react'
import { SLOTS, type Ledger, type SlotStatus } from '../types'
import { SLOT_LABEL, STATUS_LABEL, formatSlot } from '../lib'

const STATUS_STYLE = {
  empty: { icon: Circle, tone: 'text-muted' },
  ok: { icon: Check, tone: 'text-ok' },
  ambiguous: { icon: CircleHelp, tone: 'text-warn' },
  unresolved: { icon: TriangleAlert, tone: 'text-bad' },
} satisfies Record<SlotStatus, { icon: typeof Circle; tone: string }>

export default function LedgerPanel({ ledger }: { ledger: Ledger | undefined }) {
  return (
    <section aria-labelledby="ledger-title">
      <h2 id="ledger-title" className="text-xl">
        Terms so far
      </h2>
      <dl className="mt-3 divide-y divide-line border-y border-line">
        {SLOTS.map((name) => {
          const slot = ledger?.[name]
          const status = slot?.status ?? 'empty'
          const { icon: Icon, tone } = STATUS_STYLE[status]
          const value = formatSlot(name, slot)
          return (
            <div key={name} className="grid grid-cols-[7rem_1fr] gap-x-3 py-3">
              <dt className="font-semibold">{SLOT_LABEL[name]}</dt>
              <dd>
                <span className={value ? '' : 'text-muted'}>{value ?? 'Nothing said yet'}</span>
                <span className={`mt-0.5 flex items-center gap-1.5 ${tone}`}>
                  <Icon size={16} aria-hidden="true" />
                  {STATUS_LABEL[status]}
                </span>
              </dd>
            </div>
          )
        })}
      </dl>
    </section>
  )
}

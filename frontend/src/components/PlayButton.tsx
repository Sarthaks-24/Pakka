import { Volume2 } from 'lucide-react'

export default function PlayButton({ url, label, play }: { url: string | null | undefined; label: string; play: (url: string) => void }) {
  return (
    <button type="button" className="btn" disabled={!url} onClick={() => url && play(url)}>
      <Volume2 size={18} aria-hidden="true" />
      {label}
    </button>
  )
}

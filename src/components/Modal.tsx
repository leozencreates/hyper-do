import { useEffect, useRef, type ReactNode } from 'react'
import { useEscape } from '../lib/hooks'
import { pushBackButton } from '../lib/tg-bridge'

interface Props {
  title: string
  onClose(): void
  children: ReactNode
}

/** Centered dialog: closes on Escape, on clicking the backdrop and (Telegram Mini App) on the client's BackButton. */
export default function Modal({ title, onClose, children }: Props) {
  useEscape(onClose)
  // One BackButton registration per mount; the latest onClose is read through the ref (no show/hide churn on re-renders).
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => pushBackButton(() => closeRef.current()), [])
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

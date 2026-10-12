import type { ReactNode } from 'react'
import { useEscape } from '../lib/hooks'

interface Props {
  title: string
  onClose(): void
  children: ReactNode
}

/** Centered dialog: closes on Escape and on clicking the backdrop. */
export default function Modal({ title, onClose, children }: Props) {
  useEscape(onClose)
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

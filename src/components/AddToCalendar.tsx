import { useEffect, useRef, useState } from 'react'
import type { Task } from '../lib/types'
import { calendarLink, downloadTaskIcs, type LinkKind } from '../lib/calendar-links'
import { useT } from '../lib/useT'

const LINKS: { kind: LinkKind; key: 'cal_link_google' | 'cal_link_outlook' | 'cal_link_office' | 'cal_link_yahoo'; icon: string }[] = [
  { kind: 'google', key: 'cal_link_google', icon: '🟦' },
  { kind: 'outlook', key: 'cal_link_outlook', icon: '🟪' },
  { kind: 'office', key: 'cal_link_office', icon: '🟧' },
  { kind: 'yahoo', key: 'cal_link_yahoo', icon: '🟫' },
]

/** "Add to calendar" menu for a task with a due date: deep links (no account needed) + .ics download. */
export default function AddToCalendar({ task }: { task: Task }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  if (task.dueAt === null) return null

  return (
    <span className="cal-add" ref={ref}>
      <button type="button" className="mini" onClick={() => setOpen((o) => !o)}>
        📆 {t('cal_add_to')} ▾
      </button>
      {open && (
        <div className="cal-popover">
          {LINKS.map((l) => {
            const href = calendarLink(l.kind, task)
            return (
              href && (
                <a key={l.kind} href={href} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>
                  <span className="cal-popover-icon">{l.icon}</span> {t(l.key)}
                </a>
              )
            )
          })}
          <button
            type="button"
            onClick={() => {
              downloadTaskIcs(task)
              setOpen(false)
            }}
          >
            <span className="cal-popover-icon">⬇</span> {t('cal_link_ics')}
          </button>
        </div>
      )}
    </span>
  )
}

import type { Task } from '../lib/types'
import { formatDue } from '../lib/dates'
import { stuckDates } from '../lib/tasks'
import { useLang, useT } from '../lib/useT'
import Modal from './Modal'

interface Props {
  task: Task
  now: number
  /** ✂ Split: open the editor (counter reset by the caller). */
  onSplit(): void
  /** 📅 New due date chosen. */
  onDate(dueAt: number): void
  /** ▶ Do it now: focus (+ Hyper Focus where available). */
  onNow(): void
  /** 🗑 Let it go: delete (the usual undo toast follows). */
  onDrop(): void
  /** Keep going: only the counter starts over. */
  onKeep(): void
  onClose(): void
}

/** "Stuck on this?" (docs/2026-10-20-stuck-and-start-by-design.md): one decision for a task snoozed SNOOZE_NUDGE+ times. */
export default function Stuck({ task, now, onSplit, onDate, onNow, onDrop, onKeep, onClose }: Props) {
  const t = useT()
  const lang = useLang()
  const { tomorrow, nextWeek } = stuckDates(task, now)
  return (
    <Modal title={t('stuck_title')} onClose={onClose}>
      <p className="hint">{t('stuck_hint', { title: task.title, n: task.snoozeCount })}</p>
      <div className="stuck-options">
        <button className="stuck-opt primary" autoFocus onClick={onSplit}>
          <b>{t('stuck_split')}</b>
          <small>{t('stuck_split_d')}</small>
        </button>
        <div className="stuck-opt stuck-dates">
          <b>{t('stuck_date')}</b>
          <div className="row">
            <button className="mini" onClick={() => onDate(tomorrow)} title={formatDue(tomorrow, lang, now)}>
              {t('stuck_tomorrow')} · {formatDue(tomorrow, lang, now)}
            </button>
            <button className="mini" onClick={() => onDate(nextWeek)} title={formatDue(nextWeek, lang, now)}>
              {t('stuck_next_week')} · {formatDue(nextWeek, lang, now)}
            </button>
          </div>
        </div>
        <button className="stuck-opt" onClick={onNow}>
          <b>{t('stuck_now')}</b>
        </button>
        <button className="stuck-opt danger-soft" onClick={onDrop}>
          <b>{t('stuck_drop')}</b>
        </button>
      </div>
      <div className="modal-actions">
        <button className="ghost" onClick={onKeep}>
          {t('stuck_keep')}
        </button>
      </div>
    </Modal>
  )
}

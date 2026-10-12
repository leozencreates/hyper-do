import { useState } from 'react'
import type { Task } from '../lib/types'
import { formatDue, isOverdue, relativeMinutes } from '../lib/dates'
import { useLang, useT } from '../lib/useT'
import AddToCalendar from './AddToCalendar'

export interface DragHandlers {
  dragging: boolean
  onDragStart(): void
  onDragEnd(): void
  onDrop(): void
}

interface Props {
  task: Task
  highlighted: boolean
  onComplete(): void
  onReopen(): void
  onEdit(): void
  onFocus(): void
  onSnooze(minutes: number): void
  onToggleSub(subId: string): void
  onDelete(): void
  onDuplicate(): void
  onPostpone(): void
  drag?: DragHandlers
}

export default function TaskItem({ task, highlighted, onComplete, onReopen, onEdit, onFocus, onSnooze, onToggleSub, onDelete, onDuplicate, onPostpone, drag }: Props) {
  const t = useT()
  const lang = useLang()
  const [open, setOpen] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [over, setOver] = useState(false)
  const done = task.completedAt !== null
  const overdue = !done && isOverdue(task.dueAt)
  const subDone = task.subtasks.filter((s) => s.done).length
  const snoozed = task.snoozedUntil !== null && task.snoozedUntil > Date.now()

  const cls = ['task', `p-${task.priority}`, done && 'done', overdue && 'overdue', task.focused && 'focused', highlighted && 'highlight', drag?.dragging && 'dragging', over && 'drag-over']
    .filter(Boolean)
    .join(' ')

  return (
    <li
      id={'task-' + task.id}
      className={cls}
      draggable={!!drag}
      onDragStart={(e) => {
        if (!drag) return
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', task.id)
        drag.onDragStart()
      }}
      onDragEnd={() => {
        drag?.onDragEnd()
        setOver(false)
      }}
      onDragOver={(e) => {
        if (!drag) return
        e.preventDefault()
        if (!over) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!drag) return
        e.preventDefault()
        setOver(false)
        drag.onDrop()
      }}
    >
      <button className="check" onClick={done ? onReopen : onComplete} title={done ? t('reopen') : t('finish')}>
        {done ? '✓' : ''}
      </button>

      <div className="task-body" onClick={() => setOpen((o) => !o)}>
        <div className="task-title-row">
          <span className="task-title">{task.title}</span>
          {task.focused && <span className="chip focus">🎯</span>}
          {task.status !== 'todo' && !done && <span className="chip">{t(`col_${task.status}` as const)}</span>}
          {task.recurrence !== 'none' && <span className="chip">↻</span>}
          {task.calendarEventId && (
            <span className="chip cal" title={t('cal_imported')}>
              📅
            </span>
          )}
          {task.remindEveryMin > 0 && !done && (
            <span className={snoozed ? 'chip muted' : 'chip remind'} title={t('remind_interval')}>
              {snoozed ? `😴 ${relativeMinutes(task.snoozedUntil! - Date.now(), lang)}` : `🔔 ${task.remindEveryMin}′`}
            </span>
          )}
        </div>
        <div className="task-meta">
          {task.dueAt !== null && <span className={overdue ? 'due overdue' : 'due'}>{formatDue(task.dueAt, lang)}</span>}
          {task.subtasks.length > 0 && (
            <span className="sub-progress">
              <span className="bar">
                <span style={{ width: `${(subDone / task.subtasks.length) * 100}%` }} />
              </span>
              {subDone}/{task.subtasks.length}
            </span>
          )}
          {task.tags.map((x) => (
            <span key={x} className="tag">
              #{x}
            </span>
          ))}
        </div>

        {open && (
          <div className="task-detail" onClick={(e) => e.stopPropagation()}>
            {task.notes && <p className="notes">{task.notes}</p>}
            {task.subtasks.length > 0 && (
              <ul className="subtasks">
                {task.subtasks.map((s) => (
                  <li key={s.id}>
                    <label>
                      <input type="checkbox" checked={s.done} onChange={() => onToggleSub(s.id)} disabled={done} />
                      <span className={s.done ? 'sub done' : 'sub'}>{s.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {!done && (
              <div className="snooze-row">
                {task.remindEveryMin > 0 && (
                  <>
                    <span>{t('snooze')}</span>
                    {[15, 30, 60, 180].map((m) => (
                      <button key={m} className="mini" onClick={() => onSnooze(m)}>
                        {m < 60 ? t('rel_min', { n: m }) : t('rel_hour', { n: m / 60 })}
                      </button>
                    ))}
                  </>
                )}
                {task.dueAt !== null && (
                  <button className="mini" onClick={onPostpone}>
                    📅 {t('postpone_tomorrow')}
                  </button>
                )}
                <AddToCalendar task={task} />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="task-actions">
        {!done && (
          <button className="icon" title={task.focused ? t('focus_off') : t('focus_on')} onClick={onFocus}>
            🎯
          </button>
        )}
        <button className="icon" title={t('edit')} onClick={onEdit}>
          ✎
        </button>
        <button className="icon" title={t('duplicate')} onClick={onDuplicate}>
          ⧉
        </button>
        {confirmDel ? (
          <>
            <button className="mini danger" onClick={onDelete}>
              {t('delete')}
            </button>
            <button className="mini" onClick={() => setConfirmDel(false)}>
              {t('cancel')}
            </button>
          </>
        ) : (
          <button className="icon" title={t('delete')} onClick={() => setConfirmDel(true)}>
            🗑
          </button>
        )}
      </div>
    </li>
  )
}

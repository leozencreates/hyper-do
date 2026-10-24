import { useState } from 'react'
import { ENERGY_ICON, type Task } from '../lib/types'
import { formatDue, formatMinutes, isOverdue, recurrenceLabel, recurrenceText, relativeMinutes } from '../lib/dates'
import { isStuck, startBy } from '../lib/tasks'
import { isRunnable } from '../lib/routine'
import { useLang, useT } from '../lib/useT'
import { usePlanningCopy } from '../lib/planning-i18n'
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
  /** Minutes spent on the task in Hyper Focus work rounds (focus log). */
  spentMin?: number
  /** `escalationLevel(task, settings)`: ≥ 1 shows the "👀 ×N" chip. */
  escalation?: 0 | 1 | 2
  onComplete(): void
  onReopen(): void
  onEdit(): void
  onFocus(): void
  onSnooze(minutes: number): void
  onToggleSub(subId: string): void
  onDelete(): void
  onDuplicate(): void
  onPostpone(): void
  /** 😴 ×N chip (snoozed `SNOOZE_NUDGE`+ times): opens the "stuck?" dialog. Absent = chip not clickable. */
  onStuck?(): void
  /** ▶ Run (routines with steps): opens the step-by-step runner. */
  onRun?(): void
  onStart?(): void
  drag?: DragHandlers
}

export default function TaskItem({ task, highlighted, spentMin = 0, escalation = 0, onComplete, onReopen, onEdit, onFocus, onSnooze, onToggleSub, onDelete, onDuplicate, onPostpone, onStuck, onRun, onStart, drag }: Props) {
  const t = useT()
  const c = usePlanningCopy()
  const lang = useLang()
  const [open, setOpen] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [over, setOver] = useState(false)
  const done = task.completedAt !== null
  const overdue = !done && isOverdue(task.dueAt)
  const subDone = task.subtasks.filter((s) => s.done).length
  const snoozed = task.snoozedUntil !== null && task.snoozedUntil > Date.now()
  const est = task.estimateMin
  const overEstimate = est !== null && spentMin > est
  const start = startBy(task)
  const stuck = isStuck(task)

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
          {task.routine && (
            <span className="chip routine" title={t('rt_chip_title')}>
              🔁
            </span>
          )}
          {task.status !== 'todo' && !done && <span className="chip">{t(`col_${task.status}` as const)}</span>}
          {task.recurrence !== 'none' && (
            <span className="chip rec" title={recurrenceText(task.recurrence, task.recurrenceRule, lang)}>
              {recurrenceLabel(task.recurrence, task.recurrenceRule, lang)}
            </span>
          )}
          {task.energy && (
            <span className={`chip energy ${task.energy}`} title={t(`energy_${task.energy}` as const)}>
              {ENERGY_ICON[task.energy]}
            </span>
          )}
          {(est !== null || spentMin > 0) && (
            <span
              className={overEstimate ? 'chip est over' : 'chip est'}
              title={est !== null && spentMin > 0 ? t('spent_title', { spent: formatMinutes(spentMin, lang), est: formatMinutes(est, lang) }) : spentMin > 0 ? t('spent_only_title', { spent: formatMinutes(spentMin, lang) }) : t('estimate')}
            >
              ⏱ {spentMin > 0 ? (est !== null ? `${formatMinutes(spentMin, lang)} / ${formatMinutes(est, lang)}` : formatMinutes(spentMin, lang)) : `~${formatMinutes(est!, lang)}`}
            </span>
          )}
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
          {start && (
            <span className={start.late ? 'chip startby late' : 'chip startby'} title={t('startby_title', { d: formatMinutes(est!, lang) })}>
              {start.late ? t('startby_now', { d: formatMinutes(est!, lang) }) : t('startby_chip', { t: formatDue(start.at, lang) })}
            </span>
          )}
          {stuck && (
            <button
              type="button"
              className="chip stuck"
              title={t('stuck_chip_title', { n: task.snoozeCount })}
              disabled={!onStuck}
              onClick={(e) => {
                e.stopPropagation()
                onStuck?.()
              }}
            >
              {t('stuck_chip', { n: task.snoozeCount })}
            </button>
          )}
          {!done && escalation >= 1 && (
            <span className={escalation >= 2 ? 'chip nag hot' : 'chip nag'} title={t('nag_chip_title', { n: task.nagCount })}>
              {t('nag_chip', { n: task.nagCount })}
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
          {task.attachments.length > 0 && (
            <span className="chip att" title={t('att_chip_title', { n: task.attachments.length })}>
              📎 {task.attachments.length}
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
            {!done && !task.archived && onStart && <div className="row planning-row"><button className="mini" onClick={onStart}>{c.start}</button></div>}
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
        {onRun && isRunnable(task) && (
          <button className="mini rt-run" title={t('rt_run_title')} onClick={onRun}>
            {t('rt_run')}
          </button>
        )}
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

import type { Task } from '../lib/types'
import { formatDue, isOverdue } from '../lib/dates'
import { useLang, useT } from '../lib/useT'

interface Props {
  task: Task
  onComplete(): void
  onUnfocus(): void
  onToggleSub(subId: string): void
}

/** Tek bir göreve odaklanmayı kolaylaştıran büyük, dikkat çeken alan. */
export default function FocusBanner({ task, onComplete, onUnfocus, onToggleSub }: Props) {
  const t = useT()
  const lang = useLang()
  const next = task.subtasks.find((s) => !s.done)
  const overdue = isOverdue(task.dueAt)
  return (
    <section className={overdue ? 'focus-banner overdue' : 'focus-banner'}>
      <div className="focus-label">{t('focus_label')}</div>
      <div className="focus-title">{task.title}</div>
      <div className="focus-meta">
        {task.dueAt !== null && <span className={overdue ? 'due overdue' : 'due'}>{formatDue(task.dueAt, lang)}</span>}
        {task.remindEveryMin > 0 && <span>🔔 {t('every_min', { n: task.remindEveryMin })}</span>}
      </div>
      {next && (
        <label className="focus-next">
          <input type="checkbox" checked={false} onChange={() => onToggleSub(next.id)} />
          <span>
            {t('next_step')} <b>{next.title}</b>
          </span>
        </label>
      )}
      <div className="focus-actions">
        <button className="primary big" onClick={onComplete}>
          {t('finished')}
        </button>
        <button className="ghost" onClick={onUnfocus}>
          {t('unfocus')}
        </button>
      </div>
    </section>
  )
}

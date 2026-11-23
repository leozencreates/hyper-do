import type { Task } from '../lib/types'
import { formatDue, isOverdue } from '../lib/dates'
import { useLang, useT } from '../lib/useT'

interface Props {
  task: Task
  onComplete(): void
  onUnfocus(): void
  onToggleSub(subId: string): void
  onHyperFocus?(): void
  /** Position among several focused tasks (1-based) and their count: compact card + "n/count" label. */
  index?: number
  count?: number
}

/** Odaktaki görev için büyük, dikkat çeken alan; birden fazla görev odaktaysa yan yana kompakt kartlar. */
export default function FocusBanner({ task, onComplete, onUnfocus, onToggleSub, onHyperFocus, index = 1, count = 1 }: Props) {
  const t = useT()
  const lang = useLang()
  const next = task.subtasks.find((s) => !s.done)
  const overdue = isOverdue(task.dueAt)
  const cls = ['focus-banner', overdue && 'overdue', count > 1 && 'compact'].filter(Boolean).join(' ')
  return (
    <section className={cls}>
      <div className="focus-label">{count > 1 ? t('focus_label_many', { n: index, max: count }) : t('focus_label')}</div>
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
        {onHyperFocus && (
          <button className="hf-start" onClick={onHyperFocus}>
            {t('hf_start')}
          </button>
        )}
        <button className="ghost" onClick={onUnfocus}>
          {t('unfocus')}
        </button>
      </div>
    </section>
  )
}

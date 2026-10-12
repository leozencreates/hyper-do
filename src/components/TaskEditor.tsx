import { useState } from 'react'
import { PRIORITIES, RECURRENCES, STATUSES, type Recurrence, type Task } from '../lib/types'
import { fromLocalInput, toLocalInput } from '../lib/dates'
import { uid } from '../lib/tasks'
import { useT } from '../lib/useT'
import Modal from './Modal'

interface Props {
  task: Task
  allTags: string[]
  onSave(t: Task): void
  onCancel(): void
}

const REMIND_OPTIONS = [0, 5, 10, 15, 20, 30, 45, 60, 120]

export default function TaskEditor({ task, allTags, onSave, onCancel }: Props) {
  const t = useT()
  const [x, setX] = useState<Task>(task)
  const [tagInput, setTagInput] = useState('')
  const [subInput, setSubInput] = useState('')
  const set = <K extends keyof Task>(k: K, v: Task[K]) => setX((p) => ({ ...p, [k]: v }))

  const addTag = (raw: string) => {
    const v = raw.trim().replace(/^#/, '').toLowerCase()
    if (v && !x.tags.includes(v)) set('tags', [...x.tags, v])
    setTagInput('')
  }
  const addSub = () => {
    const v = subInput.trim()
    if (!v) return
    set('subtasks', [...x.subtasks, { id: uid(), title: v, done: false }])
    setSubInput('')
  }

  const canSave = x.title.trim().length > 0

  return (
    <Modal title={task.title ? t('edit_task') : t('new_task_title')} onClose={onCancel}>
      <label className="field">
        <span>{t('title')}</span>
        <input autoFocus value={x.title} onChange={(e) => set('title', e.target.value)} placeholder={t('title_ph')} />
      </label>

      <label className="field">
        <span>{t('note')}</span>
        <textarea rows={2} value={x.notes} onChange={(e) => set('notes', e.target.value)} placeholder={t('note_ph')} />
      </label>

      <div className="grid2">
        <div className="field">
          <span>{t('priority')}</span>
          <div className="seg">
            {PRIORITIES.map((p) => (
              <button key={p} type="button" className={x.priority === p ? `seg-btn active p-${p}` : 'seg-btn'} onClick={() => set('priority', p)}>
                {t(`p_${p}` as const)}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>{t('due')}</span>
          <input type="datetime-local" value={toLocalInput(x.dueAt)} onChange={(e) => set('dueAt', fromLocalInput(e.target.value))} />
        </label>
      </div>

      <div className="grid2">
        <label className="field">
          <span>{t('remind_label')}</span>
          <select value={x.remindEveryMin} onChange={(e) => set('remindEveryMin', Number(e.target.value))}>
            {REMIND_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? t('no_reminder') : m < 60 ? t('remind_every_min', { n: m }) : t('remind_every_hour', { n: m / 60 })}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t('recurrence')}</span>
          <select value={x.recurrence} onChange={(e) => set('recurrence', e.target.value as Recurrence)}>
            {RECURRENCES.map((r) => (
              <option key={r} value={r}>
                {t(`r_${r}` as const)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="field">
        <span>{t('status_label')}</span>
        <div className="seg">
          {STATUSES.map((s) => (
            <button key={s} type="button" className={x.status === s ? 'seg-btn active lang' : 'seg-btn'} onClick={() => set('status', s)}>
              {t(`col_${s}` as const)}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>{t('tags')}</span>
        <div className="chips-input">
          {x.tags.map((tag) => (
            <span key={tag} className="tag removable" onClick={() => set('tags', x.tags.filter((y) => y !== tag))}>
              #{tag} ×
            </span>
          ))}
          <input
            list="tag-suggestions"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                addTag(tagInput)
              }
            }}
            onBlur={() => tagInput && addTag(tagInput)}
            placeholder={t('tag_ph')}
          />
          <datalist id="tag-suggestions">
            {allTags.map((y) => (
              <option key={y} value={y} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="field">
        <span>{t('subtasks')}</span>
        {x.subtasks.length > 0 && (
          <ul className="subtasks edit">
            {x.subtasks.map((s) => (
              <li key={s.id}>
                <input type="checkbox" checked={s.done} onChange={() => set('subtasks', x.subtasks.map((y) => (y.id === s.id ? { ...y, done: !y.done } : y)))} />
                <input
                  className="sub-title"
                  value={s.title}
                  onChange={(e) => set('subtasks', x.subtasks.map((y) => (y.id === s.id ? { ...y, title: e.target.value } : y)))}
                />
                <button type="button" className="icon" onClick={() => set('subtasks', x.subtasks.filter((y) => y.id !== s.id))}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <input
            value={subInput}
            onChange={(e) => setSubInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addSub()
              }
            }}
            placeholder={t('sub_ph')}
          />
          <button type="button" className="mini" onClick={addSub}>
            {t('add')}
          </button>
        </div>
      </div>

      <div className="modal-actions">
        <button className="ghost" onClick={onCancel}>
          {t('cancel_btn')}
        </button>
        <button className="primary" disabled={!canSave} onClick={() => onSave({ ...x, title: x.title.trim() })}>
          {t('save')}
        </button>
      </div>
    </Modal>
  )
}

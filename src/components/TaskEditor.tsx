import { useState } from 'react'
import { DEFAULT_RECURRENCE_RULE, ENERGIES, ESTIMATE_PRESETS, PRIORITIES, RECURRENCES, RECURRENCE_UNITS, STATUSES, type Recurrence, type RecurrenceRule, type RecurrenceUnit, type Task } from '../lib/types'
import { formatMinutes, fromLocalInput, recurrenceUnitName, toLocalInput, weekdayShort } from '../lib/dates'
import { uid } from '../lib/tasks'
import { useLang, useT } from '../lib/useT'
import Modal from './Modal'

interface Props {
  task: Task
  allTags: string[]
  onSave(t: Task): void
  onCancel(): void
}

const REMIND_OPTIONS = [0, 5, 10, 15, 20, 30, 45, 60, 120]
/** Weekday toggles in Monday-first order (0 = Sunday). */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

export default function TaskEditor({ task, allTags, onSave, onCancel }: Props) {
  const t = useT()
  const lang = useLang()
  const [x, setX] = useState<Task>(task)
  const [tagInput, setTagInput] = useState('')
  const [subInput, setSubInput] = useState('')
  const set = <K extends keyof Task>(k: K, v: Task[K]) => setX((p) => ({ ...p, [k]: v }))
  const rule: RecurrenceRule = x.recurrenceRule ?? DEFAULT_RECURRENCE_RULE
  const setRule = (patch: Partial<RecurrenceRule>) => set('recurrenceRule', { ...rule, ...patch })
  const setRecurrence = (r: Recurrence) => {
    setX((p) => {
      const { recurrenceRule, ...rest } = p
      return r === 'custom' ? { ...rest, recurrence: r, recurrenceRule: recurrenceRule ?? { ...DEFAULT_RECURRENCE_RULE } } : { ...rest, recurrence: r }
    })
  }
  const toggleWeekday = (wd: number) => {
    const days = rule.weekdays ?? []
    const next = days.includes(wd) ? days.filter((d) => d !== wd) : [...days, wd].sort((a, b) => a - b)
    setRule({ weekdays: next.length ? next : undefined })
  }

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
          <select value={x.recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
            {RECURRENCES.map((r) => (
              <option key={r} value={r}>
                {t(`r_${r}` as const)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {x.recurrence === 'custom' && (
        <div className="field rec-custom">
          <div className="row rec-every">
            <span>{t('rec_every')}</span>
            <input
              type="number"
              className="rec-n"
              min={1}
              max={999}
              value={rule.every}
              onChange={(e) => {
                const n = Math.floor(Number(e.target.value))
                setRule({ every: n >= 1 ? n : 1 })
              }}
            />
            <select value={rule.unit} onChange={(e) => setRule({ unit: e.target.value as RecurrenceUnit, weekdays: e.target.value === 'week' ? rule.weekdays : undefined })}>
              {RECURRENCE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {recurrenceUnitName(lang, u, rule.every)}
                </option>
              ))}
            </select>
          </div>
          {rule.unit === 'week' && (
            <div className="row rec-weekdays">
              <span>{t('rec_weekdays_label')}</span>
              {WEEKDAY_ORDER.map((wd) => (
                <button key={wd} type="button" className={rule.weekdays?.includes(wd) ? 'mini active' : 'mini'} onClick={() => toggleWeekday(wd)}>
                  {weekdayShort(lang, wd)}
                </button>
              ))}
            </div>
          )}
          <label className="toggle">
            <input type="checkbox" checked={!!rule.afterCompletion} onChange={(e) => setRule({ afterCompletion: e.target.checked || undefined })} />
            <span>
              <b>{t('rec_after_completion')}</b>
              <small>{t('rec_after_completion_d')}</small>
            </span>
          </label>
        </div>
      )}

      <div className="grid2">
        <div className="field">
          <span>{t('estimate')}</span>
          <div className="est-row">
            {ESTIMATE_PRESETS.map((m) => (
              <button key={m} type="button" className={x.estimateMin === m ? 'mini active' : 'mini'} onClick={() => set('estimateMin', x.estimateMin === m ? null : m)}>
                {formatMinutes(m, lang)}
              </button>
            ))}
            <input
              type="number"
              className="est-input"
              min={1}
              max={1440}
              placeholder={t('estimate_custom_ph')}
              value={x.estimateMin ?? ''}
              onChange={(e) => {
                const n = Number(e.target.value)
                set('estimateMin', e.target.value === '' || !(n > 0) ? null : Math.round(n))
              }}
            />
          </div>
        </div>
        <div className="field">
          <span>{t('energy')}</span>
          <div className="seg">
            <button type="button" className={x.energy === null ? 'seg-btn active lang' : 'seg-btn'} onClick={() => set('energy', null)}>
              {t('energy_none')}
            </button>
            {ENERGIES.map((e) => (
              <button key={e} type="button" className={x.energy === e ? `seg-btn active energy-${e}` : 'seg-btn'} onClick={() => set('energy', e)}>
                {t(`energy_${e}` as const)}
              </button>
            ))}
          </div>
        </div>
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
        <button
          className="primary"
          disabled={!canSave}
          onClick={() => {
            const { recurrenceRule, ...rest } = x
            onSave(x.recurrence === 'custom' ? { ...rest, recurrenceRule: recurrenceRule ?? { ...DEFAULT_RECURRENCE_RULE }, title: x.title.trim() } : { ...rest, title: x.title.trim() })
          }}
        >
          {t('save')}
        </button>
      </div>
    </Modal>
  )
}

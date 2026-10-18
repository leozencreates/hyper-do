import { useMemo, useState } from 'react'
import { ENERGIES, type Energy, type Task } from '../lib/types'
import { NEXT_MINUTES, rankNext, reasonText } from '../lib/whatnow'
import { formatDue, formatMinutes } from '../lib/dates'
import { priorityIcon } from '../lib/tasks'
import { useLang, useT } from '../lib/useT'
import Modal from './Modal'

interface Props {
  tasks: Task[]
  now: number
  onFocus(task: Task): void
  /** Absent = no Hyper Focus button (Mini App, or a session is already running). */
  onHyperFocus?(task: Task): void
  onOpen(task: Task): void
  onClose(): void
}

/** "What now?": one suggestion with its reasons; energy / time chips re-rank, "Another" walks down the ranking. */
export default function WhatNow({ tasks, now, onFocus, onHyperFocus, onOpen, onClose }: Props) {
  const t = useT()
  const lang = useLang()
  const [energy, setEnergy] = useState<Energy | null>(null)
  const [minutes, setMinutes] = useState<number | null>(null)
  const [index, setIndex] = useState(0)
  // ranked once per chip change, not on every clock tick (the pick must not jump while the dialog is open)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ranked = useMemo(() => rankNext(tasks, { energy, minutes }, now), [tasks, energy, minutes])
  const pick = ranked.length ? ranked[index % ranked.length] : null

  const chip = <T,>(active: boolean, label: string, value: T, set: (v: T) => void, cls = '') => (
    <button
      key={label}
      type="button"
      className={active ? `seg-btn active ${cls || 'lang'}` : 'seg-btn'}
      onClick={() => {
        set(value)
        setIndex(0)
      }}
    >
      {label}
    </button>
  )

  return (
    <Modal title={t('wn_title')} onClose={onClose}>
      <div className="field">
        <span>{t('wn_energy')}</span>
        <div className="seg">
          {chip(energy === null, t('energy_none'), null, setEnergy)}
          {ENERGIES.map((e) => chip(energy === e, t(`energy_${e}` as const), e as Energy | null, setEnergy, `energy-${e}`))}
        </div>
      </div>
      <div className="field">
        <span>{t('wn_time')}</span>
        <div className="seg">
          {chip(minutes === null, t('energy_none'), null, setMinutes)}
          {NEXT_MINUTES.map((m) => chip(minutes === m, formatMinutes(m, lang), m as number | null, setMinutes))}
        </div>
      </div>

      {pick ? (
        <div className="wn-card">
          <div className="wn-title">
            {priorityIcon(pick.task.priority)} {pick.task.title}
          </div>
          <div className="wn-reasons">
            {pick.task.dueAt !== null && <span className="chip">{formatDue(pick.task.dueAt, lang, now)}</span>}
            {pick.reasons.slice(0, 3).map((r) => (
              <span key={r.kind} className="chip wn-reason">
                {reasonText(r, lang)}
              </span>
            ))}
          </div>
          {ranked.length > 1 && <p className="hint">{t('wn_rank', { i: (index % ranked.length) + 1, n: ranked.length })}</p>}
        </div>
      ) : (
        <p className="hint">{t('wn_none')}</p>
      )}

      <div className="modal-actions wn-actions">
        {pick && ranked.length > 1 && (
          <button className="ghost" onClick={() => setIndex((i) => i + 1)}>
            {t('wn_another')}
          </button>
        )}
        {pick && (
          <button className="ghost" onClick={() => onOpen(pick.task)}>
            {t('wn_open')}
          </button>
        )}
        {pick && onHyperFocus && (
          <button className="ghost" onClick={() => onHyperFocus(pick.task)}>
            {t('wn_hf')}
          </button>
        )}
        {pick ? (
          <button className="primary" autoFocus onClick={() => onFocus(pick.task)}>
            {t('easy_focus')}
          </button>
        ) : (
          <button className="primary" onClick={onClose}>
            {t('dismiss')}
          </button>
        )}
      </div>
    </Modal>
  )
}

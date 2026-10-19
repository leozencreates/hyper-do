import { useEffect, useState } from 'react'
import type { Subtask, Task } from '../lib/types'
import { advance, currentStep, runFinished, runProgress, startRun, type RunState } from '../lib/routine'
import { useT } from '../lib/useT'
import Modal from './Modal'

interface Props {
  task: Task
  /** Writes the step changes (a reaction: nag reset + updatedAt through the normal update path). */
  onSteps(subtasks: Subtask[]): void
  /** Completes the routine (celebration, streak, next recurring copy). */
  onComplete(): void
  onClose(): void
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** One step at a time (docs/2026-10-20-routines-design.md): ✓ Done (Enter) / ⏭ Skip / ↶ Back, stopwatch per step. */
export default function RoutineRunner({ task, onSteps, onComplete, onClose }: Props) {
  const t = useT()
  const [st, setSt] = useState<RunState>(() => startRun(task, Date.now()))
  const [tick, setTick] = useState(Date.now())
  useEffect(() => {
    const h = window.setInterval(() => setTick(Date.now()), 1000)
    return () => window.clearInterval(h)
  }, [])

  const act = (action: 'done' | 'skip' | 'back') => {
    const r = advance(task, st, action, Date.now())
    if (r.subtasks !== task.subtasks) onSteps(r.subtasks)
    setSt(r.state)
    // everything checked → the routine is done (no summary needed)
    if (r.state.current === null && r.subtasks.every((s) => s.done)) onComplete()
  }

  // Enter = Done while a step is shown (buttons keep their own focus handling)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || runFinished(st) || (e.target as HTMLElement).tagName === 'BUTTON') return
      e.preventDefault()
      act('done')
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  const step = currentStep(task, st)
  const p = runProgress(task, st)
  const index = step ? task.subtasks.findIndex((s) => s.id === step.id) + 1 : p.total

  return (
    <Modal title={task.title} onClose={onClose}>
      <div className="rt-progress" aria-hidden="true">
        <span style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} />
      </div>
      {step ? (
        <>
          <p className="hint">{t('rt_step', { k: index, n: p.total })}</p>
          <div className="rt-step">{step.title}</div>
          <p className="hint rt-clock">{t('rt_step_time', { t: clock(tick - st.stepStartedAt) })}</p>
          <div className="modal-actions rt-actions">
            <button className="ghost" disabled={st.history.length === 0} onClick={() => act('back')}>
              {t('rt_back')}
            </button>
            <button className="ghost" onClick={() => act('skip')}>
              {t('rt_skip')}
            </button>
            <button className="primary big" autoFocus onClick={() => act('done')}>
              {t('rt_done')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="rt-summary">{t('rt_summary', { done: p.done, total: p.total, skipped: p.total - p.done })}</p>
          <div className="modal-actions rt-actions">
            <button className="ghost" disabled={st.history.length === 0} onClick={() => act('back')}>
              {t('rt_back')}
            </button>
            <button className="ghost" onClick={onClose}>
              {t('rt_later')}
            </button>
            <button className="primary" autoFocus onClick={onComplete}>
              {t('rt_finish')}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

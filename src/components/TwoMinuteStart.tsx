import { useEffect, useState } from 'react'
import type { Task } from '../lib/types'
import { usePlanningCopy } from '../lib/planning-i18n'
import Modal from './Modal'

export default function TwoMinuteStart({ task, onStep, onContinue, onClose }: {
  task: Task; onStep(step: string): void; onContinue?(): void; onClose(): void
}) {
  const c = usePlanningCopy()
  const [step, setStep] = useState(task.firstStep || task.subtasks.find((s) => !s.done)?.title || '')
  const [end, setEnd] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { if (!end) return; const timer = window.setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer) }, [end])
  const remaining = end === null ? 120 : Math.max(0, Math.ceil((end - now) / 1000))
  return <Modal title={c.start} onClose={onClose}>
    <h3>{task.title}</h3>
    {end === null ? <label className="field"><span>{c.first}</span><input autoFocus value={step} placeholder={c.firstHint} onChange={(e) => setStep(e.target.value)} /></label> : <p className="first-step">{step}</p>}
    <div className="starter-clock" role="timer">{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</div>
    {remaining === 0 && <p role="status">{c.finished}</p>}
    <div className="modal-actions">
      <button className="ghost" onClick={onClose}>{c.stop}</button>
      {end === null ? <button className="primary" disabled={!step.trim()} onClick={() => { onStep(step.trim()); const time = Date.now(); setNow(time); setEnd(time + 120000) }}>{c.go}</button>
        : onContinue && <button className="primary" onClick={onContinue}>{c.keep}</button>}
    </div>
  </Modal>
}

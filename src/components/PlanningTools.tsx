import { useState } from 'react'
import type { AppData, Settings, Task } from '../lib/types'
import { dayKey } from '../lib/dates'
import { reviewTasks } from '../lib/planning'
import { newTask, uid } from '../lib/tasks'
import { usePlanningCopy } from '../lib/planning-i18n'
import Modal from './Modal'

export function WeeklyReview({ data, now, onEdit, onArchive, onClose }: { data: AppData; now: number; onEdit(t: Task): void; onArchive(t: Task): void; onClose(): void }) {
  const c = usePlanningCopy()
  const tasks = reviewTasks(data.tasks, now)
  const from = new Date(now); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - 6)
  const completed = Object.entries(data.dailyDone).filter(([key]) => key >= dayKey(from.getTime()) && key <= dayKey(now)).reduce((n, [, count]) => n + count, 0)
  const minutes = Math.round(data.focusLog.filter((e) => e.phase === 'work').reduce((n, e) => n + Math.max(0, Math.min(e.endedAt, now) - Math.max(e.startedAt, from.getTime())), 0) / 60000)
  return <Modal title={c.review} onClose={onClose}>
    <p>{c.completed}: <b>{completed}</b> · {c.focus}: <b>{minutes}</b></p><p className="hint">{c.reviewHint}</p>
    {tasks.length === 0 && <p>{c.reviewEmpty}</p>}
    <ul className="review-list">{tasks.map((task) => <li key={task.id}><b>{task.title}</b><small>↻ {task.snoozeCount}</small><div className="row">
      <button className="mini" onClick={() => onEdit(task)}>{c.split}</button><button className="mini" onClick={() => onEdit(task)}>{c.replan}</button>
      <button className="mini" onClick={() => onArchive(task)}>{c.archived}</button>
    </div></li>)}</ul>
  </Modal>
}

export function Templates({ settings, onChange, onUse, onClose }: { settings: Settings; onChange(s: Settings): void; onUse(t: Task): void; onClose(): void }) {
  const c = usePlanningCopy()
  const [confirm, setConfirm] = useState<string | null>(null)
  return <Modal title={c.templates} onClose={onClose}><p className="hint">{c.templateHint}</p>
    <button className="primary" onClick={() => onUse(newTask({}, settings))}>＋ {c.saveTemplate}</button>
    <ul className="review-list">{settings.taskTemplates.map((template) => <li key={template.id}><b>{template.name}</b><div className="row">
      <button className="mini" onClick={() => onUse(newTask({ ...template.task, id: uid(), createdAt: Date.now(), updatedAt: Date.now(), dueAt: null, completedAt: null, followUpAt: null, dependsOn: [], focused: false, archived: false, status: 'todo', snoozedUntil: null, snoozeCount: 0, nagCount: 0, history: [], attachments: [], subtasks: template.task.subtasks.map((s) => ({ ...s, id: uid(), done: false })) }, settings))}>{c.use}</button>
      <button className="mini" onClick={() => { if (confirm !== template.id) setConfirm(template.id); else { onChange({ ...settings, taskTemplates: settings.taskTemplates.filter((x) => x.id !== template.id) }); setConfirm(null) } }}>{confirm === template.id ? `${c.delete}?` : c.delete}</button>
    </div></li>)}</ul>
  </Modal>
}

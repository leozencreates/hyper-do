/**
 * All task mutations the UI can perform, built on top of the store's `setTasks`.
 * Keeps App.tsx about layout; the pure list operations live in tasks.ts.
 */
import { useEffect, useState } from 'react'
import type { Settings, Status, Task } from './types'
import { completeTask, duplicateTask, newTask, reorderTasks } from './tasks'
import { parseQuickAdd } from './parse'
import { DAY } from './dates'
import { useT } from './useT'

const UNDO_TIMEOUT_MS = 6000

interface Deps {
  tasks: Task[]
  settings: Settings
  setTasks(fn: (tasks: Task[]) => Task[]): void
  setSettings(fn: (s: Settings) => Settings): void
}

export interface QuickAddOptions {
  status?: Status
  /** Due time used when the text itself names none (Today view: end of today). */
  defaultDueAt?: number | null
}

export function useTaskActions({ tasks, settings, setTasks, setSettings }: Deps) {
  const t = useT()
  const [undo, setUndo] = useState<{ task: Task; index: number } | null>(null)

  // Geri alma bildirimi 6 sn sonra kaybolur
  useEffect(() => {
    if (!undo) return
    const h = setTimeout(() => setUndo(null), UNDO_TIMEOUT_MS)
    return () => clearTimeout(h)
  }, [undo])

  const update = (id: string, patch: Partial<Task>) => setTasks((ts) => ts.map((x) => (x.id === id ? { ...x, ...patch } : x)))

  const remove = (id: string) => {
    const index = tasks.findIndex((x) => x.id === id)
    if (index < 0) return
    setUndo({ task: tasks[index], index })
    setTasks((ts) => ts.filter((x) => x.id !== id))
  }

  const undoDelete = () => {
    if (!undo) return
    const { task, index } = undo
    setTasks((ts) => {
      const out = [...ts]
      out.splice(Math.min(index, out.length), 0, task)
      return out
    })
    setUndo(null)
  }

  const complete = (id: string) => setTasks((ts) => completeTask(ts, id))
  const reopen = (id: string) => update(id, { completedAt: null })
  const setFocus = (id: string, on: boolean) => setTasks((ts) => ts.map((x) => ({ ...x, focused: x.id === id ? on : false })))
  const snooze = (id: string, minutes: number) => update(id, { snoozedUntil: Date.now() + minutes * 60_000 })
  const toggleSub = (task: Task, sid: string) => update(task.id, { subtasks: task.subtasks.map((s) => (s.id === sid ? { ...s, done: !s.done } : s)) })
  const duplicate = (id: string) => setTasks((ts) => duplicateTask(ts, id, t('copy_suffix')))

  /** Son tarihi bir gün ileri alır (geçmişteyse bugünden itibaren) ve susturmayı kaldırır. */
  const postpone = (task: Task) => {
    if (task.dueAt === null) return
    const base = Math.max(task.dueAt, Date.now())
    update(task.id, { dueAt: base + DAY, snoozedUntil: null })
  }

  const clearDone = () => setTasks((ts) => ts.filter((x) => x.completedAt === null))

  /** Create or replace a task edited in the editor dialog. */
  const save = (task: Task) => setTasks((ts) => (ts.some((x) => x.id === task.id) ? ts.map((x) => (x.id === task.id ? task : x)) : [task, ...ts]))

  /** Hızlı ekleme: doğal dil ayrıştırılır ("yarın 18:00 fatura #ev !1 @30dk"). */
  const quickAdd = (text: string, { status = 'todo', defaultDueAt = null }: QuickAddOptions = {}) => {
    const p = parseQuickAdd(text, settings.language)
    if (!p.title) return
    const nt = newTask(
      {
        title: p.title,
        dueAt: p.dueAt ?? defaultDueAt,
        priority: p.priority ?? 'medium',
        tags: p.tags,
        remindEveryMin: p.remindEveryMin ?? settings.defaultRemindEveryMin,
        status,
        order: Math.min(0, ...tasks.map((x) => x.order)) - 1000, // en üste
      },
      settings,
    )
    setTasks((ts) => [nt, ...ts])
  }

  /** Pano: kartı başka sütuna / sıraya taşı. "Bitti" sütununa bırakmak görevi tamamlar. */
  const move = (id: string, to: Status | 'done', beforeId: string | null) => {
    setTasks((ts) => {
      const task = ts.find((x) => x.id === id)
      if (!task) return ts
      if (to === 'done') return task.completedAt !== null ? ts : completeTask(ts, id)
      const reopened = task.completedAt !== null ? ts.map((x) => (x.id === id ? { ...x, completedAt: null } : x)) : ts
      return reorderTasks(reopened, id, beforeId, to)
    })
  }

  /** Liste görünümünde sürükleyerek sıralama; sıralama otomatik "Elle" moduna geçer. */
  const reorder = (draggedId: string, beforeId: string | null) => {
    setTasks((ts) => reorderTasks(ts, draggedId, beforeId))
    if (settings.sort !== 'manual') setSettings((s) => ({ ...s, sort: 'manual' }))
  }

  return { undo, undoDelete, update, remove, complete, reopen, setFocus, snooze, toggleSub, duplicate, postpone, clearDone, save, quickAdd, move, reorder }
}

export type TaskActions = ReturnType<typeof useTaskActions>

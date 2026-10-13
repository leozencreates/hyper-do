/**
 * All task mutations the UI can perform, built on top of the store's `setTasks` / `updateData`.
 * Keeps App.tsx about layout; the pure list operations live in tasks.ts / stats.ts.
 */
import { useEffect, useState } from 'react'
import type { AppData, Settings, Status, Task } from './types'
import { duplicateTask, reorderTasks, taskFromQuickAdd, touchTask, type QuickAddOptions } from './tasks'
import { resetNag } from './reminder'
import { completeInData, recordReopen } from './stats'
import { addTombstones, dropTombstones } from './sync'
import { splitBrainDump } from './parse'
import { DAY } from './dates'
import { useT } from './useT'

export type { QuickAddOptions }

const UNDO_TIMEOUT_MS = 6000

interface Deps {
  tasks: Task[]
  settings: Settings
  setTasks(fn: (tasks: Task[]) => Task[]): void
  setSettings(fn: (s: Settings) => Settings): void
  /** Whole-document update: completions also touch `dailyDone`. */
  updateData(fn: (d: AppData) => AppData): void
  /** Called after a task was completed through the UI (celebration). */
  onCompleted?(task: Task): void
}

export function useTaskActions({ tasks, settings, setTasks, setSettings, updateData, onCompleted }: Deps) {
  const t = useT()
  const [undo, setUndo] = useState<{ task: Task; index: number } | null>(null)

  // Geri alma bildirimi 6 sn sonra kaybolur
  useEffect(() => {
    if (!undo) return
    const h = setTimeout(() => setUndo(null), UNDO_TIMEOUT_MS)
    return () => clearTimeout(h)
  }, [undo])

  // Every change stamps `updatedAt` (#16); the store's `bumpChanged` is only the safety net.
  const update = (id: string, patch: Partial<Task>) => setTasks((ts) => ts.map((x) => (x.id === id ? touchTask({ ...x, ...patch }) : x)))
  /** Patch + escalation reset: the user reacted to the task. */
  const react = (id: string, patch: Partial<Task>) => update(id, { ...patch, nagCount: 0 })

  /** Deleting writes a tombstone so the other devices drop their copy too (#16). */
  const remove = (id: string) => {
    const index = tasks.findIndex((x) => x.id === id)
    if (index < 0) return
    setUndo({ task: tasks[index], index })
    updateData((d) => ({ ...d, tasks: d.tasks.filter((x) => x.id !== id), deleted: addTombstones(d.deleted, [id], Date.now()) }))
  }

  /** Puts the task back, newer than its tombstone, and forgets the tombstone. */
  const undoDelete = () => {
    if (!undo) return
    const { task, index } = undo
    updateData((d) => {
      const tomb = d.deleted.find((x) => x.id === task.id)
      const revived = touchTask(task, Math.max(Date.now(), (tomb?.at ?? 0) + 1))
      const out = [...d.tasks]
      out.splice(Math.min(index, out.length), 0, revived)
      return { ...d, tasks: out, deleted: dropTombstones(d.deleted, [task.id]) }
    })
    setUndo(null)
  }

  /** Completes a task (nag reset inside `completeTask`), counts it for today's streak, celebrates. */
  const complete = (id: string) => {
    const task = tasks.find((x) => x.id === id)
    if (!task || task.completedAt !== null) return
    updateData((d) => completeInData(d, id))
    onCompleted?.(task)
  }
  const reopen = (id: string) =>
    updateData((d) => {
      const task = d.tasks.find((x) => x.id === id)
      if (!task || task.completedAt === null) return d
      return recordReopen({ ...d, tasks: d.tasks.map((x) => (x.id === id ? touchTask({ ...x, completedAt: null }) : x)) }, task.completedAt)
    })
  const setFocus = (id: string, on: boolean) => setTasks((ts) => ts.map((x) => (x.id === id ? touchTask({ ...x, focused: on, nagCount: 0 }) : x.focused ? touchTask({ ...x, focused: false }) : x)))
  const snooze = (id: string, minutes: number) => react(id, { snoozedUntil: Date.now() + minutes * 60_000 })
  const toggleSub = (task: Task, sid: string) => update(task.id, { subtasks: task.subtasks.map((s) => (s.id === sid ? { ...s, done: !s.done } : s)) })
  const duplicate = (id: string) => setTasks((ts) => duplicateTask(ts, id, t('copy_suffix')))

  /** Son tarihi bir gün ileri alır (geçmişteyse bugünden itibaren) ve susturmayı kaldırır. */
  const postpone = (task: Task) => {
    if (task.dueAt === null) return
    const base = Math.max(task.dueAt, Date.now())
    react(task.id, { dueAt: base + DAY, snoozedUntil: null })
  }

  /** Removes every completed task and leaves a tombstone for each (#16). */
  const clearDone = () =>
    updateData((d) => {
      const gone = d.tasks.filter((x) => x.completedAt !== null).map((x) => x.id)
      if (gone.length === 0) return d
      return { ...d, tasks: d.tasks.filter((x) => x.completedAt === null), deleted: addTombstones(d.deleted, gone, Date.now()) }
    })

  /** Create or replace a task edited in the editor dialog (an edit counts as a reaction: nag reset). */
  const save = (task: Task) => {
    const nt = touchTask(resetNag(task))
    setTasks((ts) => (ts.some((x) => x.id === nt.id) ? ts.map((x) => (x.id === nt.id ? nt : x)) : [nt, ...ts]))
  }

  /** Hızlı ekleme: doğal dil ayrıştırılır ("yarın 18:00 fatura öde #ev !1 @30dk"). Same helper as the popup and Telegram. */
  const quickAdd = (text: string, opts: Pick<QuickAddOptions, 'status' | 'defaultDueAt'> = {}) => {
    const nt = taskFromQuickAdd(text, settings, { ...opts, tasks })
    if (nt) setTasks((ts) => [nt, ...ts])
  }

  /**
   * Brain dump (#11): one task per line, in the written order (first line on top).
   * Lines are created last-to-first so the first line ends up with the smallest `order`.
   */
  const quickAddMany = (lines: string[], opts: Pick<QuickAddOptions, 'status' | 'defaultDueAt'> = {}) => {
    const created: Task[] = []
    for (const line of splitBrainDump(lines.join('\n')).reverse()) {
      const nt = taskFromQuickAdd(line, settings, { ...opts, tasks: [...tasks, ...created] })
      if (nt) created.push(nt)
    }
    created.reverse()
    if (created.length) setTasks((ts) => [...created, ...ts])
    return created.length
  }

  /** Pano: kartı başka sütuna / sıraya taşı. "Bitti" sütununa bırakmak görevi tamamlar. */
  const move = (id: string, to: Status | 'done', beforeId: string | null) => {
    const task = tasks.find((x) => x.id === id)
    if (!task) return
    if (to === 'done') {
      complete(id)
      return
    }
    updateData((d) => {
      const cur = d.tasks.find((x) => x.id === id)
      if (!cur) return d
      const base = cur.completedAt !== null ? recordReopen({ ...d, tasks: d.tasks.map((x) => (x.id === id ? touchTask({ ...x, completedAt: null }) : x)) }, cur.completedAt) : d
      return { ...base, tasks: reorderTasks(base.tasks, id, beforeId, to) }
    })
  }

  /** Liste görünümünde sürükleyerek sıralama; sıralama otomatik "Elle" moduna geçer. */
  const reorder = (draggedId: string, beforeId: string | null) => {
    setTasks((ts) => reorderTasks(ts, draggedId, beforeId))
    if (settings.sort !== 'manual') setSettings((s) => ({ ...s, sort: 'manual' }))
  }

  return { undo, undoDelete, update, remove, complete, reopen, setFocus, snooze, toggleSub, duplicate, postpone, clearDone, save, quickAdd, quickAddMany, move, reorder }
}

export type TaskActions = ReturnType<typeof useTaskActions>

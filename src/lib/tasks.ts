/**
 * Platformdan bağımsız görev yardımcıları (React içermez).
 * Electron ana süreci (Telegram botu) ve arayüz aynı mantığı kullanır.
 */
import type { Settings, SortMode, Status, Task } from './types'
import { nextOccurrence } from './dates'

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

export const STATUSES: Status[] = ['todo', 'doing', 'waiting']
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 }

export function newTask(partial: Partial<Task>, settings: Settings): Task {
  const now = Date.now()
  return {
    id: uid(),
    title: '',
    notes: '',
    priority: 'medium',
    tags: [],
    dueAt: null,
    recurrence: 'none',
    subtasks: [],
    remindEveryMin: settings.defaultRemindEveryMin,
    snoozedUntil: null,
    focused: false,
    status: 'todo',
    order: now,
    completedAt: null,
    createdAt: now,
    ...partial,
  }
}

/** Eski kayıtlarda eksik olabilecek alanları tamamlar. */
export function normalizeTask(t: Partial<Task> & { id: string }): Task {
  const createdAt = t.createdAt ?? Date.now()
  return {
    id: t.id,
    title: t.title ?? '',
    notes: t.notes ?? '',
    priority: t.priority ?? 'medium',
    tags: Array.isArray(t.tags) ? t.tags : [],
    dueAt: t.dueAt ?? null,
    recurrence: t.recurrence ?? 'none',
    subtasks: Array.isArray(t.subtasks) ? t.subtasks : [],
    remindEveryMin: t.remindEveryMin ?? 0,
    snoozedUntil: t.snoozedUntil ?? null,
    focused: t.focused ?? false,
    status: STATUSES.includes(t.status as Status) ? (t.status as Status) : 'todo',
    order: typeof t.order === 'number' ? t.order : createdAt,
    completedAt: t.completedAt ?? null,
    createdAt,
    ...(t.calendarEventId ? { calendarEventId: t.calendarEventId } : {}),
  }
}

/** Görevi tamamlar; tekrarlayan ise bir sonraki kopyasını üretir. */
export function completeTask(tasks: Task[], id: string): Task[] {
  const t = tasks.find((x) => x.id === id)
  if (!t) return tasks
  const now = Date.now()
  const done: Task = { ...t, completedAt: now, focused: false, snoozedUntil: null }
  const out = tasks.map((x) => (x.id === id ? done : x))
  if (t.recurrence !== 'none') {
    const base = t.dueAt ?? now
    out.unshift({
      ...t,
      id: uid(),
      dueAt: nextOccurrence(base, t.recurrence, now),
      subtasks: t.subtasks.map((s) => ({ ...s, done: false })),
      completedAt: null,
      snoozedUntil: null,
      focused: false,
      status: 'todo',
      order: now,
      createdAt: now,
    })
  }
  return out
}

/** Görevin kopyasını (alt görevler sıfırlanmış, yeni kimlikle) hemen altına ekler. */
export function duplicateTask(tasks: Task[], id: string, suffix: string): Task[] {
  const i = tasks.findIndex((x) => x.id === id)
  if (i < 0) return tasks
  const t = tasks[i]
  const now = Date.now()
  const copy: Task = {
    ...t,
    id: uid(),
    title: `${t.title} ${suffix}`.trim(),
    subtasks: t.subtasks.map((s) => ({ ...s, id: uid(), done: false })),
    completedAt: null,
    snoozedUntil: null,
    focused: false,
    order: t.order + 0.5,
    createdAt: now,
  }
  const out = [...tasks]
  out.splice(i + 1, 0, copy)
  return out
}

/**
 * Sürükle-bırak: `draggedId` görevini `beforeId` görevinin önüne (beforeId null ise sona) taşır.
 * Tüm görevlerin `order` değerleri yeniden numaralanır; isteğe bağlı olarak durum da değişir.
 */
export function reorderTasks(tasks: Task[], draggedId: string, beforeId: string | null, status?: Status): Task[] {
  if (draggedId === beforeId) return tasks
  const dragged = tasks.find((x) => x.id === draggedId)
  if (!dragged) return tasks
  const sorted = [...tasks].sort((a, b) => a.order - b.order).filter((x) => x.id !== draggedId)
  const moved: Task = status && status !== dragged.status ? { ...dragged, status } : dragged
  const at = beforeId ? sorted.findIndex((x) => x.id === beforeId) : -1
  if (at < 0) sorted.push(moved)
  else sorted.splice(at, 0, moved)
  const orderOf = new Map(sorted.map((x, i) => [x.id, (i + 1) * 1000]))
  return tasks.map((x) => {
    const o = orderOf.get(x.id)!
    const base = x.id === draggedId ? moved : x
    return base.order === o ? base : { ...base, order: o }
  })
}

export function sortTasks(tasks: Task[], mode: SortMode, nowMs = Date.now()): Task[] {
  const isOverdue = (t: Task) => t.dueAt !== null && t.dueAt < nowMs
  return [...tasks].sort((a, b) => {
    switch (mode) {
      case 'manual':
        return a.order - b.order
      case 'due':
        return (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || a.order - b.order
      case 'priority':
        return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)
      case 'created':
        return b.createdAt - a.createdAt
      case 'alpha':
        return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
      default: {
        if (a.focused !== b.focused) return a.focused ? -1 : 1
        const ao = isOverdue(a)
        const bo = isOverdue(b)
        if (ao !== bo) return ao ? -1 : 1
        if (a.priority !== b.priority) return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
        if (a.dueAt !== b.dueAt) return (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)
        return a.order - b.order
      }
    }
  })
}

/** Açık görevler: önce odak, sonra öncelik, sonra son tarih. (Telegram /list) */
export function openTasksSorted(tasks: Task[]): Task[] {
  return sortTasks(
    tasks.filter((t) => t.completedAt === null),
    'smart',
  )
}

/** Arama: başlık, not ve etiketlerde (küçük/büyük harf duyarsız). */
export function matchesQuery(t: Task, q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  return t.title.toLowerCase().includes(s) || t.notes.toLowerCase().includes(s) || t.tags.some((x) => x.toLowerCase().includes(s)) || t.subtasks.some((x) => x.title.toLowerCase().includes(s))
}

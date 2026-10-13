/**
 * Platformdan bağımsız görev yardımcıları (React içermez).
 * Electron ana süreci (Telegram botu) ve arayüz aynı mantığı kullanır.
 */
import { DEFAULT_RECURRENCE_RULE, ENERGIES, RECURRENCES, RECURRENCE_UNITS, STATUSES, type Energy, type Priority, type Recurrence, type RecurrenceRule, type RecurrenceUnit, type Settings, type SortMode, type Status, type Task } from './types'
import { nextOccurrence } from './dates'
import { parseQuickAdd } from './parse'

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 }

/** Öncelik işareti: bildirim ve Telegram metinlerinde. */
export const priorityIcon = (p: Priority) => (p === 'high' ? '🔴' : p === 'medium' ? '🟠' : '🟢')

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
    nagCount: 0,
    estimateMin: null,
    energy: null,
    updatedAt: now,
    ...partial,
  }
}

/**
 * Marks a task as changed now (#16): `updatedAt` becomes `nowMs`, or one more than the previous value when
 * that is already later (a copy that arrived from a device whose clock runs ahead must still lose to this edit).
 * Keeps identity when the task already carries that exact value.
 */
export function touchTask<T extends Task>(task: T, nowMs = Date.now()): T {
  const updatedAt = Math.max(nowMs, (Number.isFinite(task.updatedAt) ? task.updatedAt : 0) + 1)
  return task.updatedAt === updatedAt ? task : { ...task, updatedAt }
}

/** True when `next` is `prev` with only `nagCount` changed (a reminder was delivered — not a user edit). */
export function onlyNagChanged(prev: Task, next: Task): boolean {
  if (prev.nagCount === next.nagCount) return false
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]) as Set<keyof Task>
  for (const k of keys) {
    if (k === 'nagCount') continue
    if (prev[k] !== next[k]) return false
  }
  return true
}

/**
 * Safety net for `updatedAt` (#16): every task of `next` that is not the very same object as in `prev`
 * (new or replaced) is touched. Call sites that forget to bump are covered this way; the ones that did are
 * touched again, which is harmless. Unchanged references keep their timestamp.
 * Exception: a replacement that differs from the previous object **only** in `nagCount` is a delivered
 * reminder, not a user edit — it keeps its timestamp so it can never win a sync conflict over a real edit.
 */
export function bumpChanged(prev: Task[], next: Task[], nowMs = Date.now()): Task[] {
  const before = new Map(prev.map((t) => [t.id, t]))
  let changed = false
  const out = next.map((t) => {
    const p = before.get(t.id)
    if (p === t || (p && onlyNagChanged(p, t))) return t
    const touched = touchTask(t, nowMs)
    if (touched !== t) changed = true
    return touched
  })
  return changed ? out : next
}

export interface QuickAddOptions {
  status?: Status
  /** Due time used when the text itself names none (Today view: end of today). */
  defaultDueAt?: number | null
  /** Existing tasks: the new one is ordered above all of them. */
  tasks?: Task[]
  /** Clock for the natural-language parser (tests). */
  now?: number
  /** When parsing leaves no title (the text was only `yarın`), use the trimmed input as the title instead of returning null. */
  fallbackTitle?: boolean
}

/**
 * Quick add: natural language → task ("tomorrow 18:00 pay bill #home !1 @30m").
 * Shared by the UI, the quick-add popup (Electron main) and the Telegram bot.
 * Returns null when nothing is left for a title.
 */
export function taskFromQuickAdd(text: string, settings: Settings, { status = 'todo', defaultDueAt = null, tasks = [], now = Date.now(), fallbackTitle = false }: QuickAddOptions = {}): Task | null {
  const p = parseQuickAdd(text, settings.language, now)
  const title = p.title || (fallbackTitle ? text.trim() : '')
  if (!title) return null
  return newTask(
    {
      title,
      dueAt: p.dueAt ?? defaultDueAt,
      priority: p.priority ?? 'medium',
      tags: p.tags,
      remindEveryMin: p.remindEveryMin ?? settings.defaultRemindEveryMin,
      estimateMin: p.estimateMin,
      energy: p.energy,
      recurrence: p.recurrence ?? 'none',
      ...(p.recurrence === 'custom' && p.recurrenceRule ? { recurrenceRule: p.recurrenceRule } : {}),
      status,
      order: Math.min(0, ...tasks.map((x) => x.order)) - 1000, // on top
    },
    settings,
  )
}

/**
 * A well-formed custom recurrence rule or null: `every` is a whole number ≥ 1, `unit` one of the four units,
 * `weekdays` (only kept for weeks) filtered to unique 0–6 sorted ascending, `afterCompletion` only when true.
 */
export function normalizeRecurrenceRule(r: unknown): RecurrenceRule | null {
  if (!r || typeof r !== 'object') return null
  const o = r as Partial<RecurrenceRule>
  if (!RECURRENCE_UNITS.includes(o.unit as RecurrenceUnit)) return null
  const unit = o.unit as RecurrenceUnit
  const every = typeof o.every === 'number' && Number.isFinite(o.every) && o.every >= 1 ? Math.floor(o.every) : 1
  const out: RecurrenceRule = { every, unit }
  if (unit === 'week' && Array.isArray(o.weekdays)) {
    const days = [...new Set(o.weekdays.filter((x): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 6))].sort((a, b) => a - b)
    if (days.length) out.weekdays = days
  }
  if (o.afterCompletion === true) out.afterCompletion = true
  return out
}

/** Eski kayıtlarda eksik olabilecek alanları tamamlar. */
export function normalizeTask(t: Partial<Task> & { id: string }): Task {
  const createdAt = t.createdAt ?? Date.now()
  const recurrence: Recurrence = RECURRENCES.includes(t.recurrence as Recurrence) ? (t.recurrence as Recurrence) : 'none'
  return {
    id: t.id,
    title: t.title ?? '',
    notes: t.notes ?? '',
    priority: t.priority ?? 'medium',
    tags: Array.isArray(t.tags) ? t.tags : [],
    dueAt: t.dueAt ?? null,
    recurrence,
    // the rule only exists for custom recurrences; an unreadable custom rule falls back to the default one
    ...(recurrence === 'custom' ? { recurrenceRule: normalizeRecurrenceRule(t.recurrenceRule) ?? { ...DEFAULT_RECURRENCE_RULE } } : {}),
    subtasks: Array.isArray(t.subtasks) ? t.subtasks : [],
    remindEveryMin: t.remindEveryMin ?? 0,
    snoozedUntil: t.snoozedUntil ?? null,
    focused: t.focused ?? false,
    status: STATUSES.includes(t.status as Status) ? (t.status as Status) : 'todo',
    order: typeof t.order === 'number' ? t.order : createdAt,
    completedAt: t.completedAt ?? null,
    createdAt,
    ...(t.calendarEventId ? { calendarEventId: t.calendarEventId } : {}),
    nagCount: typeof t.nagCount === 'number' && t.nagCount > 0 ? Math.floor(t.nagCount) : 0,
    estimateMin: typeof t.estimateMin === 'number' && t.estimateMin > 0 ? Math.round(t.estimateMin) : null,
    energy: ENERGIES.includes(t.energy as Energy) ? (t.energy as Energy) : null,
    updatedAt: typeof t.updatedAt === 'number' && Number.isFinite(t.updatedAt) ? t.updatedAt : createdAt,
  }
}

/** Görevi tamamlar; tekrarlayan ise bir sonraki kopyasını üretir (recurrence + recurrenceRule korunur). */
export function completeTask(tasks: Task[], id: string): Task[] {
  const t = tasks.find((x) => x.id === id)
  if (!t) return tasks
  const now = Date.now()
  const done: Task = touchTask({ ...t, completedAt: now, focused: false, snoozedUntil: null, nagCount: 0 }, now)
  const out = tasks.map((x) => (x.id === id ? done : x))
  if (t.recurrence !== 'none') {
    const base = t.dueAt ?? now
    out.unshift({
      ...t,
      id: uid(),
      dueAt: nextOccurrence(base, t.recurrence, now, t.recurrenceRule),
      subtasks: t.subtasks.map((s) => ({ ...s, done: false })),
      completedAt: null,
      snoozedUntil: null,
      focused: false,
      status: 'todo',
      order: now,
      createdAt: now,
      nagCount: 0,
      updatedAt: now,
    })
  }
  return out
}

/**
 * "Give me an easy one" (#10): a random open, unsnoozed task, preferring low energy, short
 * estimates and low priority. Score: energy low +3 / medium +1; estimate ≤ 15 min +2, ≤ 30 min +1;
 * priority low +1. Among the top-scoring tasks one is drawn with `rng` (0 ≤ rng() < 1).
 * Returns null when nothing is open.
 */
export function pickEasyTask(tasks: Task[], rng: () => number = Math.random, nowMs = Date.now()): Task | null {
  const candidates = tasks.filter((t) => t.completedAt === null && !(t.snoozedUntil !== null && t.snoozedUntil > nowMs))
  if (candidates.length === 0) return null
  const score = (t: Task) =>
    (t.energy === 'low' ? 3 : t.energy === 'medium' ? 1 : 0) +
    (t.estimateMin !== null ? (t.estimateMin <= 15 ? 2 : t.estimateMin <= 30 ? 1 : 0) : 0) +
    (t.priority === 'low' ? 1 : 0)
  const best = Math.max(...candidates.map(score))
  const pool = candidates.filter((t) => score(t) === best)
  const i = Math.min(pool.length - 1, Math.max(0, Math.floor(rng() * pool.length)))
  return pool[i]
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
    nagCount: 0,
    updatedAt: now,
  }
  const out = [...tasks]
  out.splice(i + 1, 0, copy)
  return out
}

/**
 * Sürükle-bırak: `draggedId` görevini `beforeId` görevinin önüne (beforeId null ise sona) taşır.
 * Tüm görevlerin `order` değerleri yeniden numaralanır; isteğe bağlı olarak durum da değişir.
 * Only tasks whose `order` (or status) actually changes are touched (`updatedAt`).
 */
export function reorderTasks(tasks: Task[], draggedId: string, beforeId: string | null, status?: Status, nowMs = Date.now()): Task[] {
  if (draggedId === beforeId) return tasks
  const dragged = tasks.find((x) => x.id === draggedId)
  if (!dragged) return tasks
  const sorted = [...tasks].sort((a, b) => a.order - b.order).filter((x) => x.id !== draggedId)
  const moved: Task = status && status !== dragged.status ? touchTask({ ...dragged, status }, nowMs) : dragged
  const at = beforeId ? sorted.findIndex((x) => x.id === beforeId) : -1
  if (at < 0) sorted.push(moved)
  else sorted.splice(at, 0, moved)
  const orderOf = new Map(sorted.map((x, i) => [x.id, (i + 1) * 1000]))
  return tasks.map((x) => {
    const o = orderOf.get(x.id)!
    const base = x.id === draggedId ? moved : x
    return base.order === o ? base : touchTask({ ...base, order: o }, nowMs)
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

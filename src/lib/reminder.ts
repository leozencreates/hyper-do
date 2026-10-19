/**
 * Platformdan bağımsız hatırlatma motoru.
 * Electron ana süreci ve tarayıcı sürümü aynı mantığı kullanır.
 */
import type { AppData, Settings, Task } from './types'
import { funTitle, translate } from './i18n'
import { isStuck, priorityIcon, touchTask } from './tasks'

export interface ReminderHit {
  task: Task
  overdue: boolean
}

/**
 * `activeFocusTaskId` value for a Hyper Focus session without a task: no task may remind
 * (no task id is the empty string, so every one is held back).
 */
export const FOCUS_NO_TASK = ''

/**
 * The only task allowed to remind right now, or null when nothing is suppressed.
 * Non-null while a Hyper Focus **work** phase is running (not paused, not expired) and
 * `settings.focusSuppressOthers` is on. Break phases never suppress.
 * A session without a task yields `FOCUS_NO_TASK` → everything is suppressed.
 */
export function activeFocusTaskId(data: Pick<AppData, 'hyperFocus' | 'settings'>, nowMs = Date.now()): string | null {
  const s = data.hyperFocus
  if (!s || !data.settings.focusSuppressOthers) return null
  if (s.phase !== 'work' || s.pausedRemaining !== null || s.endsAt <= nowMs) return null
  return s.taskId ?? FOCUS_NO_TASK
}

/** Until when `taskId`'s reminders are held back by Hyper Focus (Android planning), or null. */
export function focusSuppressedUntil(data: Pick<AppData, 'hyperFocus' | 'settings'>, taskId: string, nowMs = Date.now()): number | null {
  const id = activeFocusTaskId(data, nowMs)
  return id !== null && id !== taskId ? data.hyperFocus!.endsAt : null
}

/** Global mute (B5): true while `settings.mutedUntil` lies in the future. Tolerates old settings objects without the field. */
export function isMuted(s: Pick<Settings, 'mutedUntil'>, nowMs: number): boolean {
  const until = s.mutedUntil
  return typeof until === 'number' && until > nowMs
}

export function inQuietHours(s: Settings, now: Date): boolean {
  if (!s.quietHours.enabled) return false
  const [fh, fm] = s.quietHours.from.split(':').map(Number)
  const [th, tm] = s.quietHours.to.split(':').map(Number)
  const cur = now.getHours() * 60 + now.getMinutes()
  const from = fh * 60 + fm
  const to = th * 60 + tm
  return from <= to ? cur >= from && cur < to : cur >= from || cur < to
}

/**
 * Şu an hatırlatılması gereken görevleri döndürür ve lastNotified haritasını günceller.
 * Tamamlanan görevlerin kayıtlarını temizler.
 * `activeFocusTaskId` (see the helper above): when not null, only that task may remind; the
 * others are skipped **without** touching their counters, so they fire as soon as the round ends.
 */
export function collectDueReminders(tasks: Task[], settings: Settings, lastNotified: Map<string, number>, nowMs = Date.now(), activeFocusTaskId: string | null = null): ReminderHit[] {
  const hits: ReminderHit[] = []
  if (inQuietHours(settings, new Date(nowMs))) return hits
  if (isMuted(settings, nowMs)) return hits

  for (const t of tasks) {
    if (t.completedAt !== null) {
      lastNotified.delete(t.id)
      continue
    }
    if (!t.remindEveryMin || t.remindEveryMin <= 0) continue
    if (t.snoozedUntil && t.snoozedUntil > nowMs) continue
    if (activeFocusTaskId !== null && t.id !== activeFocusTaskId) continue

    const overdue = t.dueAt !== null && t.dueAt < nowMs
    let intervalMs = t.remindEveryMin * 60_000
    if (overdue && settings.escalateOverdue) intervalMs = Math.max(5 * 60_000, intervalMs / 2)

    const last = lastNotified.get(t.id) ?? 0
    if (nowMs - last >= intervalMs) {
      lastNotified.set(t.id, nowMs)
      hits.push({ task: t, overdue })
    }
  }
  return hits
}

/** Kaydedilen yeni veri ile sayaçları senkronlar (snooze değişti → sıfırla, yeni görev → şimdi başlat). */
export function syncCounters(prev: Task[], next: Task[], lastNotified: Map<string, number>, nowMs = Date.now()) {
  for (const t of next) {
    const p = prev.find((x) => x.id === t.id)
    if (p && p.snoozedUntil !== t.snoozedUntil) lastNotified.delete(t.id)
    if (!p) lastNotified.set(t.id, nowMs)
  }
}

// ---- Escalation ladder (#6) ----

/** Increments `nagCount` of every task in `ids`: call this right after the reminders were delivered. Does NOT bump `updatedAt` (see below). */
export function markNagged(tasks: Task[], ids: Iterable<string>): Task[] {
  const set = new Set(ids)
  if (set.size === 0) return tasks
  // Deliberately no `touchTask`: a delivered reminder is not a user edit and must never win a sync conflict (#16).
  return tasks.map((t) => (set.has(t.id) ? { ...t, nagCount: t.nagCount + 1 } : t))
}

/** Adds `counts.get(id)` to the `nagCount` of each listed task (Android: several pre-scheduled reminders fired). No `updatedAt` bump, like `markNagged`. */
export function markNaggedBy(tasks: Task[], counts: ReadonlyMap<string, number>): Task[] {
  if (counts.size === 0) return tasks
  return tasks.map((t) => {
    const n = counts.get(t.id) ?? 0
    return n > 0 ? { ...t, nagCount: t.nagCount + n } : t
  })
}

/**
 * Android nag counting (#6): the reminder times scheduled per task at the last (re)plan, kept in Preferences.
 * Every replan cancels what is still pending and plans anew from `now`, so the past entries of the previous plan
 * are exactly the notifications that fired in between.
 */
export type NagPlan = Record<string, number[]>

/**
 * How many planned reminders of each open task fired in `(task.updatedAt, nowMs]`. A reaction (done, snooze, edit,
 * `resetNag`) bumps `updatedAt`, so reminders from before it never count against the fresh ladder; `markNagged`
 * does not bump it, so repeated replans keep counting.
 */
export function deliveredNags(plan: NagPlan, tasks: Task[], nowMs: number): Map<string, number> {
  const out = new Map<string, number>()
  for (const t of tasks) {
    if (t.completedAt !== null) continue
    const n = (plan[t.id] ?? []).filter((at) => at <= nowMs && at > t.updatedAt).length
    if (n > 0) out.set(t.id, n)
  }
  return out
}

/** Reads a stored `NagPlan` tolerantly (anything unreadable → empty plan). */
export function parseNagPlan(raw: string | null | undefined): NagPlan {
  const out: NagPlan = {}
  if (!raw) return out
  try {
    const o = JSON.parse(raw) as unknown
    if (!o || typeof o !== 'object' || Array.isArray(o)) return out
    for (const [id, v] of Object.entries(o)) {
      if (Array.isArray(v)) out[id] = v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
    }
  } catch {
    /* empty plan */
  }
  return out
}

/** The user reacted (done, snooze, postpone, focus, edit…): the ladder starts over. Keeps identity when already 0. */
export function resetNag<T extends Task>(task: T, nowMs = Date.now()): T {
  return task.nagCount === 0 ? task : touchTask({ ...task, nagCount: 0 }, nowMs)
}

/**
 * 0 = normal · 1 = `telegramAfter` ignored reminders reached (escalation line in the notification)
 * · 2 = `popupAfter` reached (critical toast + mini window on Electron). Thresholds below 1 count as 1.
 */
export function escalationLevel(task: Pick<Task, 'nagCount'>, settings: Pick<Settings, 'escalation'>): 0 | 1 | 2 {
  const e = settings.escalation
  if (!e.enabled) return 0
  const popup = Math.max(1, e.popupAfter)
  const line = Math.max(1, e.telegramAfter)
  if (task.nagCount >= popup) return 2
  if (task.nagCount >= line) return 1
  return 0
}

/**
 * Escalation level of the `i`-th pre-scheduled reminder of a task (Android): it only fires after the `i` before it
 * were ignored, so it is built as if `nagCount + i` reminders had been ignored already.
 */
export function plannedEscalation(task: Pick<Task, 'nagCount'>, i: number, settings: Pick<Settings, 'escalation'>): 0 | 1 | 2 {
  return escalationLevel({ nagCount: task.nagCount + Math.max(0, i) }, settings)
}

export function buildNotification(task: Task, overdue: boolean, settings: Settings, nowMs = Date.now()): { title: string; body: string } {
  const lang = settings.language
  const t = (k: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate(lang, k, vars)
  const open = task.subtasks.filter((s) => !s.done).length
  const parts: string[] = []
  if (escalationLevel(task, settings) >= 1) parts.push(t('escalation_line', { n: task.nagCount }))
  if (task.dueAt !== null) {
    const mins = Math.abs(Math.round((task.dueAt - nowMs) / 60000))
    if (overdue) parts.push(mins < 60 ? t('late_min', { n: mins }) : t('late_hour', { n: Math.floor(mins / 60) }))
    else parts.push(mins < 60 ? t('left_min', { n: mins }) : t('left_hour', { n: Math.floor(mins / 60) }))
  }
  if (open > 0) parts.push(t('open_subs', { n: open }))
  if (isStuck(task)) parts.push(t('stuck_line', { n: task.snoozeCount }))
  parts.push(t('nag_line'))

  const plain = `${priorityIcon(task.priority)} ${task.focused ? '🎯 ' : ''}${task.title}`
  const title = settings.funTitles ? `${priorityIcon(task.priority)} ${funTitle(lang, task.title, overdue)}` : plain
  return { title, body: parts.join(' · ') }
}

/**
 * Önceden planlanacak hatırlatma zamanları (Android yerel bildirimleri için).
 * Uygulama kapalıyken de dürtebilmek için gelecekteki zamanlar şimdiden hesaplanır.
 * Sessiz saatlere ve genel susturmaya (`mutedUntil`) düşenler atlanır; son tarih geçtikten sonra aralık yarıya iner.
 * `suppressUntilMs` (see `focusSuppressedUntil`): times before it are skipped (Hyper Focus work phase).
 * The escalation ladder (#6) is applied by the caller: the i-th planned reminder is built with `nagCount + i`
 * (it fires only if the earlier ones were ignored), and `deliveredNags` counts the fired ones at the next replan.
 */
export function planReminderTimes(task: Task, settings: Settings, fromMs: number, maxCount: number, horizonMs: number, suppressUntilMs: number | null = null): { at: number; overdue: boolean }[] {
  const out: { at: number; overdue: boolean }[] = []
  if (task.completedAt !== null || !task.remindEveryMin || task.remindEveryMin <= 0) return out
  let t = Math.max(fromMs, task.snoozedUntil ?? 0)
  const end = fromMs + horizonMs
  let guard = 0
  while (out.length < maxCount && guard++ < 5000) {
    const overdue = task.dueAt !== null && task.dueAt < t
    let interval = task.remindEveryMin * 60_000
    if (overdue && settings.escalateOverdue) interval = Math.max(5 * 60_000, interval / 2)
    t += interval
    if (t > end) break
    if (suppressUntilMs !== null && t < suppressUntilMs) continue
    if (isMuted(settings, t)) continue
    if (inQuietHours(settings, new Date(t))) continue
    out.push({ at: t, overdue: task.dueAt !== null && task.dueAt < t })
  }
  return out
}

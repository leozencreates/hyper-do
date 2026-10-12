/**
 * Platformdan bağımsız hatırlatma motoru.
 * Electron ana süreci ve tarayıcı sürümü aynı mantığı kullanır.
 */
import type { Settings, Task } from './types'
import { funTitle, translate } from './i18n'
import { priorityIcon } from './tasks'

export interface ReminderHit {
  task: Task
  overdue: boolean
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
 */
export function collectDueReminders(tasks: Task[], settings: Settings, lastNotified: Map<string, number>, nowMs = Date.now()): ReminderHit[] {
  const hits: ReminderHit[] = []
  if (inQuietHours(settings, new Date(nowMs))) return hits

  for (const t of tasks) {
    if (t.completedAt !== null) {
      lastNotified.delete(t.id)
      continue
    }
    if (!t.remindEveryMin || t.remindEveryMin <= 0) continue
    if (t.snoozedUntil && t.snoozedUntil > nowMs) continue

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

export function buildNotification(task: Task, overdue: boolean, settings: Settings, nowMs = Date.now()): { title: string; body: string } {
  const lang = settings.language
  const t = (k: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate(lang, k, vars)
  const open = task.subtasks.filter((s) => !s.done).length
  const parts: string[] = []
  if (task.dueAt !== null) {
    const mins = Math.abs(Math.round((task.dueAt - nowMs) / 60000))
    if (overdue) parts.push(mins < 60 ? t('late_min', { n: mins }) : t('late_hour', { n: Math.floor(mins / 60) }))
    else parts.push(mins < 60 ? t('left_min', { n: mins }) : t('left_hour', { n: Math.floor(mins / 60) }))
  }
  if (open > 0) parts.push(t('open_subs', { n: open }))
  parts.push(t('nag_line'))

  const plain = `${priorityIcon(task.priority)} ${task.focused ? '🎯 ' : ''}${task.title}`
  const title = settings.funTitles ? `${priorityIcon(task.priority)} ${funTitle(lang, task.title, overdue)}` : plain
  return { title, body: parts.join(' · ') }
}

/**
 * Önceden planlanacak hatırlatma zamanları (Android yerel bildirimleri için).
 * Uygulama kapalıyken de dürtebilmek için gelecekteki zamanlar şimdiden hesaplanır.
 * Sessiz saatlere düşenler atlanır; son tarih geçtikten sonra aralık yarıya iner.
 */
export function planReminderTimes(task: Task, settings: Settings, fromMs: number, maxCount: number, horizonMs: number): { at: number; overdue: boolean }[] {
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
    if (inQuietHours(settings, new Date(t))) continue
    out.push({ at: t, overdue: task.dueAt !== null && task.dueAt < t })
  }
  return out
}

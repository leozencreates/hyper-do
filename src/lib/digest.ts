/**
 * Daily digest (#17 / Telegram C6) — pure, no React, no Electron.
 *
 * `buildDigest` renders the morning digest ("Good morning — N overdue, M due today, K open · 🔥 streak" plus the
 * top 3 tasks by smart order), the evening review ("Done today N · still open for today M") and, on Sunday
 * evenings, the weekly review ("done this week · open · streak"). It yields both a plain `title` / `body`
 * (desktop toast) and an HTML `html` (Telegram, `parse_mode: 'HTML'`), plus the tasks listed so the Telegram
 * message can carry `pick:` buttons.
 *
 * `digestDue` decides which digest is due now from the settings and the platform state file
 * (`lastDigestAt` / `lastEveningAt` live in `userData/hyperdo-state.json`, never in `AppData`).
 */
import type { AppData, Settings, Task } from './types'
import { translate, type Lang } from './i18n'
import { dayKey, endOfDay, formatDue, startOfDay } from './dates'
import { openTasksSorted, priorityIcon } from './tasks'
import { doneInLastDays, streak } from './stats'

export type DigestKind = 'morning' | 'evening' | 'weekly'

export interface Digest {
  kind: DigestKind
  /** Plain-text toast title / body (body lines joined with newlines). */
  title: string
  body: string
  /** Telegram HTML (title in bold, every user string escaped). */
  html: string
  /** Tasks listed in the digest, in the numbered order (top 3 by smart order; empty for the evening review). */
  tasks: Task[]
}

/** Platform state consulted by `digestDue` (timestamps of the last digests sent, or null). */
export interface DigestState {
  lastDigestAt: number | null
  lastEveningAt: number | null
}

export const DIGEST_TOP = 3

/** The morning digest is still sent this many hours after its time (a PC switched on at 11:00 gets the 08:00 digest). */
const MORNING_GRACE_H = 12

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** `HH:MM` → minutes since midnight (malformed input → 0). */
export function parseHHMM(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (!m) return 0
  return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]))
}

export function buildDigest(data: AppData, nowMs: number, lang: Lang, kind: DigestKind): Digest {
  const t = (k: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate(lang, k, vars)
  const open = openTasksSorted(data.tasks)
  const todayEnd = endOfDay(nowMs)
  const overdue = open.filter((x) => x.dueAt !== null && x.dueAt < nowMs).length
  const dueToday = open.filter((x) => x.dueAt !== null && x.dueAt >= nowMs && x.dueAt <= todayEnd).length
  const current = streak(data.dailyDone, dayKey(nowMs))
  const streakLine = current > 0 ? t('digest_streak', { n: current }) : ''

  let title: string
  let summary: string
  let tasks: Task[] = []
  if (kind === 'morning') {
    title = t('digest_morning_title')
    summary = t('digest_morning', { overdue, today: dueToday, open: open.length })
    tasks = open.slice(0, DIGEST_TOP)
  } else if (kind === 'weekly') {
    title = t('digest_weekly_title')
    summary = t('digest_weekly', { done: doneInLastDays(data.dailyDone, 7, nowMs), open: open.length })
  } else {
    title = t('digest_evening_title')
    const openToday = open.filter((x) => x.dueAt !== null && x.dueAt <= todayEnd).length
    summary = t('digest_evening', { done: data.dailyDone[dayKey(nowMs)] ?? 0, open: openToday })
  }
  const head = [summary, streakLine].filter(Boolean).join(' · ')

  const plainLines = [head]
  const htmlLines = [`<b>${esc(title)}</b>`, esc(head)]
  if (kind === 'morning' && open.length === 0) {
    plainLines.push(t('digest_empty'))
    htmlLines.push(esc(t('digest_empty')))
  }
  tasks.forEach((x, i) => {
    const due = x.dueAt !== null ? ` · ${formatDue(x.dueAt, lang, nowMs)}` : ''
    plainLines.push(`${i + 1}. ${priorityIcon(x.priority)} ${x.title}${due}`)
    htmlLines.push(`${i + 1}. ${priorityIcon(x.priority)} <b>${esc(x.title)}</b>${esc(due)}`)
  })
  return { kind, title, body: plainLines.join('\n'), html: htmlLines.join('\n'), tasks }
}

/**
 * Which digest is due at `nowMs`, or null. Morning: from `digest.time` for 12 hours, once per local day.
 * Evening: from `eveningTime` until midnight, once per local day; on Sundays it is the weekly review.
 * The morning digest is checked first, so a PC switched on late in the evening gets at most one of each.
 */
export function digestDue(settings: Pick<Settings, 'digest'>, state: DigestState, nowMs: number): DigestKind | null {
  const d = settings.digest
  const now = new Date(nowMs)
  const mins = now.getHours() * 60 + now.getMinutes()
  const today = dayKey(nowMs)
  const sentToday = (at: number | null) => at !== null && dayKey(at) === today && at >= startOfDay(nowMs)
  if (d.enabled) {
    const at = parseHHMM(d.time)
    if (mins >= at && mins < at + MORNING_GRACE_H * 60 && !sentToday(state.lastDigestAt)) return 'morning'
  }
  if (d.evening && mins >= parseHHMM(d.eveningTime) && !sentToday(state.lastEveningAt)) return now.getDay() === 0 ? 'weekly' : 'evening'
  return null
}

/**
 * Android (#17): the digests to pre-schedule as local notifications in `(fromMs, fromMs + horizonMs]`, oldest first.
 * Morning at `digest.time`, evening at `eveningTime` (Sundays: the weekly review). No grace window and no state
 * file: the plan is rebuilt from `now` on every save / resume, so a time already passed is simply not planned again.
 * The caller renders each with `buildDigest(data, at, …)`, i.e. as of its own fire time.
 */
export function planDigestTimes(settings: Pick<Settings, 'digest'>, fromMs: number, horizonMs: number): { at: number; kind: DigestKind }[] {
  const d = settings.digest
  const out: { at: number; kind: DigestKind }[] = []
  if (!d.enabled && !d.evening) return out
  const end = fromMs + horizonMs
  const at = (day: Date, hhmm: string) => {
    const m = parseHHMM(hhmm)
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(m / 60), m % 60).getTime()
  }
  for (let day = new Date(startOfDay(fromMs)); day.getTime() <= end; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
    if (d.enabled) out.push({ at: at(day, d.time), kind: 'morning' })
    if (d.evening) out.push({ at: at(day, d.eveningTime), kind: day.getDay() === 0 ? 'weekly' : 'evening' })
  }
  return out.filter((p) => p.at > fromMs && p.at <= end).sort((a, b) => a.at - b.at)
}

/** State after a digest of `kind` went out at `nowMs`. */
export function markDigestSent(state: DigestState, kind: DigestKind, nowMs: number): DigestState {
  return kind === 'morning' ? { ...state, lastDigestAt: nowMs } : { ...state, lastEveningAt: nowMs }
}

/** Reads the state file content (JSON) tolerantly: anything unreadable becomes "never sent". */
export function parseDigestState(raw: string | null | undefined): DigestState {
  const empty: DigestState = { lastDigestAt: null, lastEveningAt: null }
  if (!raw) return empty
  try {
    const o = JSON.parse(raw) as Partial<DigestState> | null
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
    return { lastDigestAt: num(o?.lastDigestAt), lastEveningAt: num(o?.lastEveningAt) }
  } catch {
    return empty
  }
}

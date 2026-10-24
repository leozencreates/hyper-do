/**
 * "What now?" — one deterministic answer to "what should I do right now?" (spec docs/2026-10-19-what-now-design.md).
 * Pure: shared by the UI dialog (WhatNow.tsx) and the Telegram `/next` command.
 *
 * Unlike `pickEasyTask` (random, low effort first) this ranks by urgency, weight and momentum, narrowed by the
 * energy and time the user says they have, and explains itself through typed reasons.
 */
import type { Energy, Task } from './types'
import { translate, type Lang } from './i18n'
import { endOfDay, formatMinutes } from './dates'
import { startBy } from './tasks'
import { isBlocked } from './planning'

export interface NextContext {
  /** Energy the user has right now (null = any). */
  energy: Energy | null
  /** Minutes available (null = any). */
  minutes: number | null
}

export const ANY_CONTEXT: NextContext = { energy: null, minutes: null }

/** Time chips offered by the UI. */
export const NEXT_MINUTES = [15, 30, 60] as const

export type NextReason =
  | { kind: 'overdue'; min: number }
  | { kind: 'focused' }
  | { kind: 'startby'; min: number }
  | { kind: 'today' }
  | { kind: 'soon' }
  | { kind: 'priority' }
  | { kind: 'doing' }
  | { kind: 'started'; done: number; total: number }
  | { kind: 'nagged'; n: number }
  | { kind: 'energy' }
  | { kind: 'fits'; min: number }
  | { kind: 'quick' }

export interface NextPick {
  task: Task
  score: number
  /** Most important first. */
  reasons: NextReason[]
}

const ENERGY_RANK: Record<Energy, number> = { low: 0, medium: 1, high: 2 }
const H = 3_600_000

/** Open, not snoozed into the future, not waiting on someone else. */
export function isNextCandidate(t: Task, nowMs: number): boolean {
  return !t.archived && t.completedAt === null && !(t.snoozedUntil !== null && t.snoozedUntil > nowMs) && t.status !== 'waiting'
}

function scoreTask(t: Task, ctx: NextContext, nowMs: number): { score: number; reasons: NextReason[] } {
  let score = 0
  const reasons: NextReason[] = []
  if (t.dueAt !== null && t.dueAt < nowMs) {
    const min = Math.round((nowMs - t.dueAt) / 60_000)
    score += 40 + Math.min(20, Math.floor((nowMs - t.dueAt) / H))
    reasons.push({ kind: 'overdue', min })
  }
  if (t.focused) {
    score += 30
    reasons.push({ kind: 'focused' })
  }
  // time blindness: the estimate says it must start now to finish by the due time
  if (startBy(t, nowMs)?.late) {
    score += 20
    reasons.push({ kind: 'startby', min: t.estimateMin! })
  }
  if (t.dueAt !== null && t.dueAt >= nowMs) {
    if (t.dueAt <= endOfDay(nowMs)) {
      score += 25
      reasons.push({ kind: 'today' })
    } else if (t.dueAt - nowMs <= 72 * H) {
      score += 10
      reasons.push({ kind: 'soon' })
    }
  }
  if (t.priority === 'high') {
    score += 15
    reasons.push({ kind: 'priority' })
  } else if (t.priority === 'medium') score += 5
  if (t.status === 'doing') {
    score += 12
    reasons.push({ kind: 'doing' })
  }
  const done = t.subtasks.filter((s) => s.done).length
  if (done > 0 && done < t.subtasks.length) {
    score += 6
    reasons.push({ kind: 'started', done, total: t.subtasks.length })
  }
  if (t.nagCount > 0) {
    score += Math.min(10, 2 * t.nagCount)
    reasons.push({ kind: 'nagged', n: t.nagCount })
  }
  if (ctx.energy !== null && t.energy !== null) {
    if (ENERGY_RANK[t.energy] <= ENERGY_RANK[ctx.energy]) {
      score += 10
      reasons.push({ kind: 'energy' })
    } else score -= 40
  }
  if (ctx.minutes !== null) {
    if (t.estimateMin !== null) {
      if (t.estimateMin <= ctx.minutes) {
        score += 10
        reasons.push({ kind: 'fits', min: t.estimateMin })
      } else score -= 40
    } else if (ctx.minutes <= 15) score -= 5
  } else if (t.estimateMin !== null && t.estimateMin <= 15) {
    score += 3
    reasons.push({ kind: 'quick' })
  }
  return { score, reasons }
}

/** Every candidate, best first (ties: earlier due date, no date last, then list order). */
export function rankNext(tasks: Task[], ctx: NextContext = ANY_CONTEXT, nowMs = Date.now()): NextPick[] {
  return tasks
    .filter((t) => isNextCandidate(t, nowMs) && !isBlocked(t, tasks))
    .map((task) => ({ task, ...scoreTask(task, ctx, nowMs) }))
    .sort((a, b) => b.score - a.score || (a.task.dueAt ?? Infinity) - (b.task.dueAt ?? Infinity) || a.task.order - b.task.order)
}

/** The `index`-th pick (0 = best), wrapping around the ranking; null when nothing is a candidate. */
export function suggestNext(tasks: Task[], ctx: NextContext = ANY_CONTEXT, nowMs = Date.now(), index = 0): NextPick | null {
  const ranked = rankNext(tasks, ctx, nowMs)
  if (ranked.length === 0) return null
  const i = ((Math.floor(index) % ranked.length) + ranked.length) % ranked.length
  return ranked[i]
}

/** One reason as a short, plain-text chip ("⏰ 2 h overdue"). */
export function reasonText(r: NextReason, lang: Lang): string {
  const t = (k: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate(lang, k, vars)
  switch (r.kind) {
    case 'overdue':
      return t('wn_r_overdue', { t: formatMinutes(r.min, lang) })
    case 'focused':
      return t('wn_r_focused')
    case 'startby':
      return t('wn_r_startby', { d: formatMinutes(r.min, lang) })
    case 'today':
      return t('wn_r_today')
    case 'soon':
      return t('wn_r_soon')
    case 'priority':
      return t('wn_r_priority')
    case 'doing':
      return t('wn_r_doing')
    case 'started':
      return t('wn_r_started', { done: r.done, total: r.total })
    case 'nagged':
      return t('wn_r_nagged', { n: r.n })
    case 'energy':
      return t('wn_r_energy')
    case 'fits':
      return t('wn_r_fits', { t: formatMinutes(r.min, lang) })
    case 'quick':
      return t('wn_r_quick')
  }
}

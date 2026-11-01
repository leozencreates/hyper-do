/**
 * Printable task list (docs/2026-11-01-print-pdf-design.md): one self-contained HTML document (inline CSS, no
 * scripts, no external assets) that the desktop turns into a PDF (`webContents.printToPDF`) or prints, and the
 * browser prints from a hidden iframe ("Save as PDF" in the print dialog). Pure: no DOM, no React.
 */
import type { Task } from './types'
import { LOCALE, translate, type Lang } from './i18n'
import { endOfDay, formatDue, formatMinutes, recurrenceText, startOfDay } from './dates'

export type PrintSectionKey = 'overdue' | 'today' | 'week' | 'later' | 'nodate'

export interface PrintSection {
  key: PrintSectionKey
  tasks: Task[]
}

const DAY = 86_400_000
const PRIO_RANK: Record<Task['priority'], number> = { high: 0, medium: 1, low: 2 }

const byDue = (a: Task, b: Task) => (a.dueAt ?? 0) - (b.dueAt ?? 0) || PRIO_RANK[a.priority] - PRIO_RANK[b.priority] || a.order - b.order
const byPrio = (a: Task, b: Task) => PRIO_RANK[a.priority] - PRIO_RANK[b.priority] || a.order - b.order

/** Groups the open (not done, not archived) tasks by due date: overdue → today → next 7 days → later → no date. Done tasks are left out. Empty sections are dropped. */
export function printSections(tasks: Task[], now: number): PrintSection[] {
  const open = tasks.filter((x) => !x.archived && x.completedAt === null)
  const todayEnd = endOfDay(now)
  const weekEnd = startOfDay(now) + 7 * DAY
  const sections: PrintSection[] = [
    { key: 'overdue', tasks: open.filter((x) => x.dueAt !== null && x.dueAt < now).sort(byDue) },
    { key: 'today', tasks: open.filter((x) => x.dueAt !== null && x.dueAt >= now && x.dueAt <= todayEnd).sort(byDue) },
    { key: 'week', tasks: open.filter((x) => x.dueAt !== null && x.dueAt > todayEnd && x.dueAt < weekEnd).sort(byDue) },
    { key: 'later', tasks: open.filter((x) => x.dueAt !== null && x.dueAt >= weekEnd && x.dueAt > todayEnd).sort(byDue) },
    { key: 'nodate', tasks: open.filter((x) => x.dueAt === null).sort(byPrio) },
  ]
  return sections.filter((s) => s.tasks.length > 0)
}

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const SECTION_LABEL: Record<PrintSectionKey, Parameters<typeof translate>[1]> = {
  overdue: 'tg_sec_overdue',
  today: 'tg_sec_today',
  week: 'view_week',
  later: 'tg_sec_later',
  nodate: 'tg_sec_nodate',
}

function taskHtml(task: Task, lang: Lang, now: number): string {
  const loc = LOCALE[lang]
  const meta: string[] = []
  if (task.dueAt !== null) {
    const abs = new Date(task.dueAt).toLocaleString(loc, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    meta.push(`<span class="due${task.dueAt < now ? ' late' : ''}">📅 ${escapeHtml(abs)} · ${escapeHtml(formatDue(task.dueAt, lang, now))}</span>`)
  }
  if (task.recurrence !== 'none') meta.push(`↻ ${escapeHtml(recurrenceText(task.recurrence, task.recurrenceRule, lang))}`)
  if (task.estimateMin !== null) meta.push(`⏱ ~${escapeHtml(formatMinutes(task.estimateMin, lang))}`)
  if (task.subtasks.length > 0) meta.push(`☑ ${task.subtasks.filter((s) => s.done).length}/${task.subtasks.length}`)
  for (const tag of task.tags) meta.push(`<span class="tag">#${escapeHtml(tag)}</span>`)

  const subs = task.subtasks.length
    ? `<ul class="subs">${task.subtasks.map((s) => `<li class="${s.done ? 'sdone' : ''}"><span class="box">${s.done ? '✓' : ''}</span>${escapeHtml(s.title)}</li>`).join('')}</ul>`
    : ''
  const notes = task.notes.trim() ? `<div class="notes">${escapeHtml(task.notes.trim())}</div>` : ''
  return (
    `<li class="task p-${task.priority}">` +
    `<span class="box"></span>` +
    `<div class="body"><div class="title-row"><span class="title">${escapeHtml(task.title)}</span>` +
    `<span class="prio">${escapeHtml(translate(lang, `p_${task.priority}` as const))}</span></div>` +
    (meta.length ? `<div class="meta">${meta.join('<span class="dot">·</span>')}</div>` : '') +
    notes +
    subs +
    `</div></li>`
  )
}

const CSS = `
@page { size: A4; margin: 14mm 13mm 16mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font: 10.5pt/1.45 "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif; color: #1d2330; background: #fff; }
header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2.5px solid #6c5ce7; padding-bottom: 8px; margin-bottom: 14px; }
.brand { font-size: 9pt; letter-spacing: .14em; text-transform: uppercase; color: #6c5ce7; font-weight: 700; }
h1 { margin: 2px 0 0; font-size: 20pt; line-height: 1.15; }
.stamp { text-align: right; font-size: 9pt; color: #5d6578; }
.stats { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
.stat { background: #f1effd; color: #4b3fc4; border-radius: 999px; padding: 1px 9px; font-weight: 600; }
.stat.late { background: #fdecec; color: #c0392b; }
section { margin-bottom: 14px; }
h2 { font-size: 11.5pt; margin: 0 0 6px; padding: 4px 10px; border-radius: 6px; background: #f4f5f9; color: #2d3446; display: flex; justify-content: space-between; break-after: avoid; }
h2 .n { color: #8a91a3; font-weight: 600; }
section.overdue h2 { background: #fdecec; color: #b03024; }
section.today h2 { background: #eaf3ff; color: #1d5fb8; }
ul { list-style: none; margin: 0; padding: 0; }
.task { display: flex; gap: 9px; padding: 7px 10px 7px 8px; border-left: 3.5px solid #c9cdd8; border-bottom: 1px solid #eceef3; break-inside: avoid; }
.task.p-high { border-left-color: #e5534b; }
.task.p-medium { border-left-color: #f0a030; }
.task.p-low { border-left-color: #4caf7d; }
.box { flex: none; width: 13px; height: 13px; margin-top: 3px; border: 1.5px solid #8a91a3; border-radius: 3px; font-size: 9px; line-height: 10px; text-align: center; color: #23784a; font-weight: 700; }
.body { flex: 1; min-width: 0; }
.title-row { display: flex; gap: 8px; align-items: baseline; justify-content: space-between; }
.title { font-weight: 600; font-size: 11pt; overflow-wrap: anywhere; }
.prio { flex: none; font-size: 8pt; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; padding: 0 7px; border-radius: 999px; background: #f1f2f6; color: #5d6578; }
.p-high .prio { background: #fdecec; color: #c0392b; }
.p-medium .prio { background: #fff4e0; color: #a86500; }
.p-low .prio { background: #e8f6ee; color: #23784a; }
.meta { margin-top: 2px; font-size: 9pt; color: #5d6578; }
.meta .dot { margin: 0 6px; color: #b5bac6; }
.due.late { color: #c0392b; font-weight: 600; }
.tag { color: #4b3fc4; }
.notes { margin-top: 4px; font-size: 9.5pt; color: #3b4255; white-space: pre-wrap; overflow-wrap: anywhere; background: #fafafc; border-radius: 5px; padding: 4px 8px; }
.subs { margin-top: 4px; }
.subs li { display: flex; gap: 7px; font-size: 9.5pt; padding: 1px 0; }
.subs .box { width: 11px; height: 11px; margin-top: 3px; font-size: 8px; line-height: 8px; }
.subs .sdone { color: #8a91a3; text-decoration: line-through; }
.empty { color: #8a91a3; text-align: center; padding: 40px 0; }
footer { margin-top: 18px; font-size: 8pt; color: #a0a6b4; text-align: center; }
`

/** The whole printable document. `now` decides overdue / today and the "created" stamp. */
export function buildPrintHtml(tasks: Task[], lang: Lang, now: number): string {
  const sections = printSections(tasks, now)
  const openN = tasks.filter((x) => !x.archived && x.completedAt === null).length
  const lateN = sections.find((s) => s.key === 'overdue')?.tasks.length ?? 0
  const title = translate(lang, 'pr_title')
  const stamp = new Date(now).toLocaleString(LOCALE[lang], { dateStyle: 'long', timeStyle: 'short' })
  const body = sections.length
    ? sections
        .map(
          (s) =>
            `<section class="${s.key}"><h2><span>${escapeHtml(translate(lang, SECTION_LABEL[s.key]))}</span><span class="n">${s.tasks.length}</span></h2>` +
            `<ul>${s.tasks.map((x) => taskHtml(x, lang, now)).join('')}</ul></section>`,
        )
        .join('')
    : `<p class="empty">${escapeHtml(translate(lang, 'pr_empty'))}</p>`
  return (
    `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><title>${escapeHtml(`Hyper Do — ${title}`)}</title><style>${CSS}</style></head><body>` +
    `<header><div><div class="brand">Hyper Do</div><h1>${escapeHtml(title)}</h1></div>` +
    `<div class="stamp">${escapeHtml(translate(lang, 'pr_created', { d: stamp }))}<div class="stats">` +
    `<span class="stat">${escapeHtml(translate(lang, 'pr_open_n', { n: openN }))}</span>` +
    (lateN ? `<span class="stat late">${escapeHtml(translate(lang, 'pr_late_n', { n: lateN }))}</span>` : '') +
    `</div></div></header>` +
    body +
    `<footer>Hyper Do · ${escapeHtml(stamp)}</footer></body></html>`
  )
}

/** File name for the PDF download: hyperdo-tasks-YYYY-MM-DD.pdf (local date). */
export function printFileName(now: number): string {
  const d = new Date(now)
  const p = (n: number) => String(n).padStart(2, '0')
  return `hyperdo-tasks-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.pdf`
}

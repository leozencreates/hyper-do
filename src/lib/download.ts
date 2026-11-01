/** Browser-only "save as file" helpers (JSON backup, .ics export). */
import type { Task } from './types'
import { buildIcs, type IcsOutEvent } from './ics'
import { taskToIcsEvent, tasksToIcs } from './calendar-links'

/** YYYY-MM-DD, for file names. */
export const dateStamp = () => new Date().toISOString().slice(0, 10)

export function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function downloadJson(filename: string, value: unknown) {
  downloadText(filename, JSON.stringify(value, null, 2), 'application/json')
}

const ICS_MIME = 'text/calendar;charset=utf-8'

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'task'

export function downloadTaskIcs(task: Task) {
  const ev: IcsOutEvent | null = taskToIcsEvent(task)
  if (ev) downloadText(`${slug(task.title)}.ics`, buildIcs([ev]), ICS_MIME)
}

export function downloadAllTasksIcs(tasks: Task[]) {
  downloadText(`hyperdo-tasks-${dateStamp()}.ics`, tasksToIcs(tasks.filter((t) => t.completedAt === null && t.dueAt !== null)), ICS_MIME)
}

/**
 * Prints a self-contained HTML document from a hidden iframe (`srcdoc`, so the page's CSP still applies: inline
 * styles only, no scripts). The browser's print dialog also offers "Save as PDF". Resolves once the dialog closed.
 */
export function printHtmlDocument(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
    const cleanup = () => setTimeout(() => frame.remove(), 1000)
    frame.onload = () => {
      const w = frame.contentWindow
      if (!w) {
        cleanup()
        reject(new Error('no frame'))
        return
      }
      try {
        w.focus()
        w.print()
        resolve()
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      } finally {
        cleanup()
      }
    }
    frame.srcdoc = html
    document.body.appendChild(frame)
  })
}

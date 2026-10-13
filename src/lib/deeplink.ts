/**
 * `hyperdo://` deep links (pure, shared by the Electron main process and tests).
 *
 *   hyperdo://task/<id>/done
 *   hyperdo://task/<id>/snooze/<minutes>
 *   hyperdo://task/<id>/open
 *
 * They are used by the buttons of Windows reminder toasts (activationType="protocol") and can be
 * typed into any launcher; the OS hands the URL to the running instance (second-instance / open-url).
 * The Windows toast XML built here follows the ToastGeneric template.
 */

export const DEEP_LINK_SCHEME = 'hyperdo'

export type DeepLinkAction = 'done' | 'snooze' | 'open'

export interface DeepLink {
  taskId: string
  action: DeepLinkAction
  /** Only for `snooze`: minutes to snooze (default 30). */
  minutes?: number
}

const DEFAULT_SNOOZE_MIN = 30

/** Builds `hyperdo://task/<id>/<action>[/<minutes>]`. The id is URL-encoded. */
export function deepLinkUrl(taskId: string, action: DeepLinkAction, minutes?: number): string {
  const base = `${DEEP_LINK_SCHEME}://task/${encodeURIComponent(taskId)}/${action}`
  return action === 'snooze' ? `${base}/${minutes ?? DEFAULT_SNOOZE_MIN}` : base
}

/** Parses a deep link; returns null for anything that is not a well-formed task link. */
export function parseDeepLink(url: string): DeepLink | null {
  const m = /^hyperdo:\/*(.*)$/i.exec(url.trim())
  if (!m) return null
  const parts = m[1]
    .replace(/[?#].*$/, '')
    .split('/')
    .filter((p) => p.length > 0)
  if (parts.length < 3 || parts[0].toLowerCase() !== 'task') return null
  let taskId: string
  try {
    taskId = decodeURIComponent(parts[1])
  } catch {
    return null
  }
  if (!taskId) return null
  const action = parts[2].toLowerCase()
  if (action === 'done' || action === 'open') return parts.length === 3 ? { taskId, action } : null
  if (action === 'snooze') {
    if (parts.length > 4) return null
    if (parts.length === 3) return { taskId, action, minutes: DEFAULT_SNOOZE_MIN }
    const minutes = Number(parts[3])
    if (!Number.isInteger(minutes) || minutes <= 0) return null
    return { taskId, action, minutes }
  }
  return null
}

/** The first `hyperdo://` argument of a command line (second-instance, first launch), or null. */
export function findDeepLinkArg(argv: readonly string[]): string | null {
  return argv.find((a) => /^hyperdo:\/\//i.test(a)) ?? null
}

/** Escapes the five XML entities so arbitrary task titles survive inside toast XML. */
export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
}

export interface ToastLabels {
  done: string
  snooze: string
  open: string
}

/**
 * Windows toast (ToastGeneric) with Done / Snooze / Open buttons that fire deep links.
 * Clicking the body opens the task; the reminder sound is the system "Reminder" event.
 */
export function reminderToastXml(taskId: string, title: string, body: string, labels: ToastLabels, snoozeMin = DEFAULT_SNOOZE_MIN): string {
  const open = escapeXml(deepLinkUrl(taskId, 'open'))
  const done = escapeXml(deepLinkUrl(taskId, 'done'))
  const snooze = escapeXml(deepLinkUrl(taskId, 'snooze', snoozeMin))
  return (
    `<toast scenario="reminder" launch="${open}" activationType="protocol">` +
    `<visual><binding template="ToastGeneric"><text>${escapeXml(title)}</text><text>${escapeXml(body)}</text></binding></visual>` +
    `<actions>` +
    `<action content="${escapeXml(labels.done)}" arguments="${done}" activationType="protocol"/>` +
    `<action content="${escapeXml(labels.snooze)}" arguments="${snooze}" activationType="protocol"/>` +
    `<action content="${escapeXml(labels.open)}" arguments="${open}" activationType="protocol"/>` +
    `</actions>` +
    `<audio src="ms-winsoundevent:Notification.Reminder"/>` +
    `</toast>`
  )
}

/**
 * "Share → Hyper Do" (#15, Android): the payload fired by MainActivity.java and how it becomes a task.
 * Pure, so the event parsing and the title/notes rule are unit-tested without Capacitor.
 */
import type { SharePayload } from './types'

/** Longest title made from shared text (the full text stays in the notes). */
export const SHARE_TITLE_MAX = 120

/**
 * Payload of the `hyperdoShare` window event. Capacitor's `triggerWindowJSEvent` copies the properties of the
 * JSON object onto the Event itself (`cap.createEvent`); a `detail` string/object is accepted too, just in case.
 * Returns null when there is nothing to share.
 */
export function parseShareEvent(e: unknown): SharePayload | null {
  if (!e || typeof e !== 'object') return null
  const ev = e as { text?: unknown; subject?: unknown; detail?: unknown }
  let src: { text?: unknown; subject?: unknown } = ev
  if (typeof ev.text !== 'string' && ev.detail !== undefined) {
    if (typeof ev.detail === 'string') {
      try {
        src = JSON.parse(ev.detail) as { text?: unknown; subject?: unknown }
      } catch {
        src = { text: ev.detail }
      }
    } else if (ev.detail && typeof ev.detail === 'object') src = ev.detail as { text?: unknown; subject?: unknown }
  }
  const text = typeof src.text === 'string' ? src.text : ''
  const subject = typeof src.subject === 'string' && src.subject.trim() ? src.subject.trim() : undefined
  if (!text.trim() && !subject) return null
  return subject ? { text, subject } : { text }
}

/**
 * Title = the subject when there is one, else the first non-empty line of the text (cut to `SHARE_TITLE_MAX`);
 * notes = the whole shared text (so a shared URL is kept even when the title is the page title).
 */
export function shareToTaskFields(p: SharePayload): { title: string; notes: string } {
  const text = p.text.replace(/\r\n?/g, '\n').trim()
  const firstLine = text.split('\n').find((l) => l.trim()) ?? ''
  let title = (p.subject?.trim() || firstLine).trim()
  if (title.length > SHARE_TITLE_MAX) title = title.slice(0, SHARE_TITLE_MAX - 1).trimEnd() + '…'
  return { title, notes: text }
}

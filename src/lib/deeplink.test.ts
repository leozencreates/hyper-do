import { describe, it, expect } from 'vitest'
import { deepLinkUrl, escapeXml, findDeepLinkArg, parseDeepLink, reminderToastXml } from './deeplink'

describe('parseDeepLink', () => {
  it('parses done / open / snooze with minutes', () => {
    expect(parseDeepLink('hyperdo://task/abc123/done')).toEqual({ taskId: 'abc123', action: 'done' })
    expect(parseDeepLink('hyperdo://task/abc123/open')).toEqual({ taskId: 'abc123', action: 'open' })
    expect(parseDeepLink('hyperdo://task/abc123/snooze/45')).toEqual({ taskId: 'abc123', action: 'snooze', minutes: 45 })
  })

  it('snooze without minutes defaults to 30', () => {
    expect(parseDeepLink('hyperdo://task/abc/snooze')).toEqual({ taskId: 'abc', action: 'snooze', minutes: 30 })
  })

  it('tolerates a trailing slash, upper-case scheme/action and URL-encoded ids', () => {
    expect(parseDeepLink('HYPERDO://task/abc/DONE/')).toEqual({ taskId: 'abc', action: 'done' })
    expect(parseDeepLink('hyperdo://task/a%20b/open')).toEqual({ taskId: 'a b', action: 'open' })
    expect(parseDeepLink('  hyperdo://task/abc/open  ')).toEqual({ taskId: 'abc', action: 'open' })
  })

  it('rejects other schemes, unknown actions, missing ids and bad minutes', () => {
    expect(parseDeepLink('https://task/abc/done')).toBeNull()
    expect(parseDeepLink('hyperdo://settings')).toBeNull()
    expect(parseDeepLink('hyperdo://task/abc')).toBeNull()
    expect(parseDeepLink('hyperdo://task/abc/delete')).toBeNull()
    expect(parseDeepLink('hyperdo://task//done')).toBeNull()
    expect(parseDeepLink('hyperdo://task/abc/snooze/0')).toBeNull()
    expect(parseDeepLink('hyperdo://task/abc/snooze/soon')).toBeNull()
    expect(parseDeepLink('hyperdo://task/abc/snooze/1.5')).toBeNull()
    expect(parseDeepLink('hyperdo://task/abc/done/extra')).toBeNull()
    expect(parseDeepLink('')).toBeNull()
  })

  it('round-trips what deepLinkUrl builds', () => {
    expect(parseDeepLink(deepLinkUrl('x y', 'done'))).toEqual({ taskId: 'x y', action: 'done' })
    expect(parseDeepLink(deepLinkUrl('id', 'snooze', 15))).toEqual({ taskId: 'id', action: 'snooze', minutes: 15 })
    expect(deepLinkUrl('id', 'snooze')).toBe('hyperdo://task/id/snooze/30')
  })
})

describe('findDeepLinkArg', () => {
  it('returns the first hyperdo:// argument of a command line', () => {
    expect(findDeepLinkArg(['C:\\app\\Hyper Do.exe', '--allow-file-access', 'hyperdo://task/a/done'])).toBe('hyperdo://task/a/done')
    expect(findDeepLinkArg(['electron.exe', '.', '--hidden'])).toBeNull()
    expect(findDeepLinkArg([])).toBeNull()
  })
})

describe('escapeXml', () => {
  it('escapes the five XML entities and leaves everything else alone', () => {
    expect(escapeXml(`Fish & chips <b>"now"</b> it's`)).toBe('Fish &amp; chips &lt;b&gt;&quot;now&quot;&lt;/b&gt; it&apos;s')
    expect(escapeXml('🔴 Ödeme – ничего')).toBe('🔴 Ödeme – ничего')
  })
})

describe('reminderToastXml', () => {
  const labels = { done: '✓ Done', snooze: '😴 30 min', open: 'Open' }

  it('produces a ToastGeneric toast with three protocol buttons and a reminder sound', () => {
    const xml = reminderToastXml('t1', 'Pay bill', '30 min left', labels)
    expect(xml.startsWith('<toast scenario="reminder" launch="hyperdo://task/t1/open" activationType="protocol">')).toBe(true)
    expect(xml).toContain('<binding template="ToastGeneric"><text>Pay bill</text><text>30 min left</text></binding>')
    expect(xml).toContain('<action content="✓ Done" arguments="hyperdo://task/t1/done" activationType="protocol"/>')
    expect(xml).toContain('<action content="😴 30 min" arguments="hyperdo://task/t1/snooze/30" activationType="protocol"/>')
    expect(xml).toContain('<action content="Open" arguments="hyperdo://task/t1/open" activationType="protocol"/>')
    expect(xml).toContain('<audio src="ms-winsoundevent:Notification.Reminder"/>')
    expect(xml.endsWith('</toast>')).toBe(true)
  })

  it('escapes title, body, labels and the id', () => {
    const xml = reminderToastXml('a b', 'R&D <review>', 'say "hi"', { done: 'A & B', snooze: '<s>', open: "'o'" })
    expect(xml).toContain('<text>R&amp;D &lt;review&gt;</text><text>say &quot;hi&quot;</text>')
    expect(xml).toContain('content="A &amp; B"')
    expect(xml).toContain('content="&lt;s&gt;"')
    expect(xml).toContain('content="&apos;o&apos;"')
    expect(xml).toContain('arguments="hyperdo://task/a%20b/done"')
    // after removing the entities nothing unescaped may remain inside <text> or in attribute values
    const stripped = xml.replace(/&(amp|lt|gt|quot|apos);/g, '')
    expect(stripped).not.toMatch(/<text>[^<]*[&<>"'][^<]*<\/text>/)
    expect(stripped).not.toMatch(/content="[^"]*[&<>'][^"]*"/)
  })

  it('uses the given snooze length', () => {
    expect(reminderToastXml('t1', 'x', 'y', labels, 60)).toContain('arguments="hyperdo://task/t1/snooze/60"')
  })
})

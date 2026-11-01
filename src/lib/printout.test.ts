import { describe, it, expect } from 'vitest'
import { buildPrintHtml, escapeHtml, printFileName, printSections } from './printout'
import { normalizeTask } from './tasks'
import type { Task } from './types'

// Tuesday, 13 October 2026, 10:00 local time
const NOW = new Date(2026, 9, 13, 10, 0).getTime()
const task = (o: Partial<Task> & { id: string }): Task => normalizeTask({ title: o.id, createdAt: NOW, order: NOW, ...o })

describe('printSections', () => {
  const tasks = [
    task({ id: 'late', dueAt: new Date(2026, 9, 12, 9, 0).getTime() }),
    task({ id: 'today', dueAt: new Date(2026, 9, 13, 18, 0).getTime() }),
    task({ id: 'week', dueAt: new Date(2026, 9, 16, 9, 0).getTime() }),
    task({ id: 'later', dueAt: new Date(2026, 10, 2, 9, 0).getTime() }),
    task({ id: 'low', priority: 'low' }),
    task({ id: 'high', priority: 'high' }),
    task({ id: 'done', completedAt: NOW - 1000 }),
    task({ id: 'arch', archived: true }),
  ]
  it('groups open tasks by due date; done and archived tasks are left out', () => {
    const s = printSections(tasks, NOW)
    expect(s.map((x) => [x.key, x.tasks.map((t) => t.id)])).toEqual([
      ['overdue', ['late']],
      ['today', ['today']],
      ['week', ['week']],
      ['later', ['later']],
      ['nodate', ['high', 'low']],
    ])
  })
  it('drops empty sections', () => {
    expect(printSections([task({ id: 'x' })], NOW).map((s) => s.key)).toEqual(['nodate'])
    expect(printSections([], NOW)).toEqual([])
  })
})

describe('buildPrintHtml', () => {
  it('escapes user text and lists notes, tags and subtasks', () => {
    const html = buildPrintHtml(
      [task({ id: 'a', title: '<b>Pay</b> & go', notes: 'line "1"', tags: ['ev'], subtasks: [{ id: 's', title: 'step <1>', done: true }] })],
      'en',
      NOW,
    )
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('&lt;b&gt;Pay&lt;/b&gt; &amp; go')
    expect(html).not.toContain('<b>Pay</b>')
    expect(html).toContain('line &quot;1&quot;')
    expect(html).toContain('#ev')
    expect(html).toContain('step &lt;1&gt;')
    expect(html).not.toMatch(/<script/i)
  })
  it('shows an empty note when there are no open tasks', () => {
    expect(buildPrintHtml([], 'en', NOW)).toContain('No open tasks.')
    const html = buildPrintHtml([task({ id: 'finished', completedAt: NOW - 1000 })], 'en', NOW)
    expect(html).toContain('No open tasks.')
    expect(html).not.toContain('finished')
  })
})

describe('helpers', () => {
  it('escapeHtml', () => expect(escapeHtml(`<a href='x'>&</a>`)).toBe('&lt;a href=&#39;x&#39;&gt;&amp;&lt;/a&gt;'))
  it('printFileName uses the local date', () => expect(printFileName(NOW)).toBe('hyperdo-tasks-2026-10-13.pdf'))
})

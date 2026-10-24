import { describe, it, expect } from 'vitest'
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, attachmentKind, formatBytes, normalizeAttachments, referencedMediaIds, rejectReason } from './attachments'
import { duplicateTask, normalizeTask } from './tasks'

const NOW = new Date(2026, 9, 24, 10, 0).getTime()
const att = (id: string, kind: 'image' | 'video' = 'image') => ({ id, kind, name: `${id}.jpg`, mime: kind === 'image' ? 'image/jpeg' : 'video/mp4', size: 1000, addedAt: NOW })

describe('attachmentKind / rejectReason', () => {
  it('accepts images and videos only', () => {
    expect(attachmentKind('image/png')).toBe('image')
    expect(attachmentKind('VIDEO/MP4')).toBe('video')
    expect(attachmentKind('application/pdf')).toBeNull()
    expect(attachmentKind('')).toBeNull()
  })
  it('rejects by type, size and count', () => {
    expect(rejectReason({ type: 'image/jpeg', size: 10 }, 0)).toBeNull()
    expect(rejectReason({ type: 'text/plain', size: 10 }, 0)).toBe('type')
    expect(rejectReason({ type: 'video/mp4', size: MAX_ATTACHMENT_BYTES + 1 }, 0)).toBe('size')
    expect(rejectReason({ type: 'image/jpeg', size: 10 }, MAX_ATTACHMENTS)).toBe('count')
  })
})

describe('normalizeAttachments', () => {
  it('drops garbage, duplicates and unknown kinds; infers kind from mime', () => {
    const out = normalizeAttachments([att('a'), att('a'), null, { id: '' }, { id: 'x', mime: 'text/plain' }, { id: 'v', mime: 'video/webm' }])
    expect(out.map((a) => [a.id, a.kind])).toEqual([
      ['a', 'image'],
      ['v', 'video'],
    ])
    expect(out[1]).toEqual({ id: 'v', kind: 'video', name: '', mime: 'video/webm', size: 0, addedAt: 0 })
  })
  it('non-arrays become an empty list', () => {
    expect(normalizeAttachments(undefined)).toEqual([])
    expect(normalizeAttachments('x')).toEqual([])
  })
  it('old tasks load with no attachments, stored ones survive normalizeTask', () => {
    expect(normalizeTask({ id: 't', createdAt: NOW }).attachments).toEqual([])
    expect(normalizeTask({ id: 't', createdAt: NOW, attachments: [att('a', 'video')] }).attachments).toEqual([att('a', 'video')])
  })
})

describe('referencedMediaIds', () => {
  it('collects ids from every task, a duplicate shares its files', () => {
    const tasks = [normalizeTask({ id: 't1', createdAt: NOW, attachments: [att('a'), att('b')] }), normalizeTask({ id: 't2', createdAt: NOW, completedAt: NOW, attachments: [att('c')] })]
    expect([...referencedMediaIds(tasks)].sort()).toEqual(['a', 'b', 'c'])
    const dup = duplicateTask(tasks, 't1', '(copy)')
    expect(dup[1].attachments.map((a) => a.id)).toEqual(['a', 'b'])
    expect(referencedMediaIds(dup.filter((t) => t.id !== 't1')).has('a')).toBe(true)
  })
})

describe('formatBytes', () => {
  it('B / KB / MB', () => {
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB')
  })
})

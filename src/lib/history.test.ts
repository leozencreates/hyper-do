import { describe, it, expect } from 'vitest'
import { logNoteChange, mergeNoteLog, normalizeNoteLog, noteChangeKind, preserveVersions, NOTE_LOG_LIMIT } from './history'
import { bumpChanged, normalizeTask } from './tasks'
import { mergeData, toSyncDoc } from './sync'
import { normalizeData } from './data'
import type { Task } from './types'

const T0 = new Date(2026, 10, 2, 9, 0).getTime()
const task = (id: string, patch: Partial<Task> = {}) => normalizeTask({ id, title: id, createdAt: T0, updatedAt: T0, ...patch })

describe('note dates', () => {
  it('classifies notes changes', () => {
    expect(noteChangeKind('', 'hello')).toBe('added')
    expect(noteChangeKind('hello', 'hello world')).toBe('edited')
    expect(noteChangeKind('hello', '  ')).toBe('removed')
    expect(noteChangeKind('hello', ' hello ')).toBeNull()
    expect(noteChangeKind('', '')).toBeNull()
  })

  it('bumpChanged stamps added / edited / removed at the change time', () => {
    const a = task('a')
    const t1 = T0 + 60_000
    const b = bumpChanged([a], [{ ...a, notes: 'first' }], t1)[0]
    expect(b.noteLog).toEqual([{ at: t1, kind: 'added' }])
    const c = bumpChanged([b], [{ ...b, notes: 'second' }], t1 + 1000)[0]
    const d = bumpChanged([c], [{ ...c, notes: '' }], t1 + 2000)[0]
    expect(d.noteLog.map((e) => e.kind)).toEqual(['removed', 'edited', 'added'])
    expect(d.noteLog[0].at).toBe(d.updatedAt)
  })

  it('leaves the log alone when only other fields change', () => {
    const a = task('a', { notes: 'x' })
    expect(bumpChanged([a], [{ ...a, title: 'renamed' }], T0 + 1)[0].noteLog).toEqual([])
  })

  it('a new task with notes is logged as added at its creation time; an existing log is kept', () => {
    const fresh = task('n', { notes: 'hi', createdAt: T0 - 5000, updatedAt: T0 - 5000 })
    expect(bumpChanged([], [fresh], T0)[0].noteLog).toEqual([{ at: T0 - 5000, kind: 'added' }])
    const restored = task('r', { notes: 'hi', noteLog: [{ at: T0 - 9000, kind: 'edited' }] })
    expect(bumpChanged([], [restored], T0)[0].noteLog).toEqual([{ at: T0 - 9000, kind: 'edited' }])
    expect(bumpChanged([], [task('e')], T0)[0].noteLog).toEqual([])
  })

  it('merges logs without duplicates, newest first, capped', () => {
    const e1 = { at: T0, kind: 'added' as const }
    const e2 = { at: T0 + 1, kind: 'edited' as const }
    expect(mergeNoteLog([e1], [e2, e1])).toEqual([e2, e1])
    const many = Array.from({ length: NOTE_LOG_LIMIT + 10 }, (_, i) => ({ at: T0 + i, kind: 'edited' as const }))
    expect(mergeNoteLog(many)).toHaveLength(NOTE_LOG_LIMIT)
  })

  it('normalizes stored logs and defaults old tasks to []', () => {
    expect(normalizeNoteLog(undefined)).toEqual([])
    expect(normalizeNoteLog([{ at: T0, kind: 'added' }, { at: 'x', kind: 'added' }, { at: T0, kind: 'nope' }, null])).toEqual([{ at: T0, kind: 'added' }])
    expect(normalizeData({ tasks: [{ id: 'old', title: 'old', createdAt: T0 }] } as never).tasks[0].noteLog).toEqual([])
  })

  it('sync keeps the events recorded on both devices', () => {
    const base = task('s', { notes: 'a' })
    const local = logNoteChange(base, { ...base, notes: 'b', updatedAt: T0 + 10 }, T0 + 10)
    const remote = logNoteChange(base, { ...base, notes: '', updatedAt: T0 + 20 }, T0 + 20)
    expect(preserveVersions(remote, local).noteLog).toEqual([{ at: T0 + 20, kind: 'removed' }, { at: T0 + 10, kind: 'edited' }])
    const doc = (tasks: Task[], deviceId: string) => toSyncDoc({ ...normalizeData({} as never), tasks }, deviceId, T0 + 30)
    const { merged } = mergeData(doc([local], 'l'), doc([remote], 'r'), T0 + 30)
    expect(merged.tasks[0].notes).toBe('')
    expect(merged.tasks[0].noteLog.map((e) => e.kind)).toEqual(['removed', 'edited'])
  })
})

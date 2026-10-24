import { describe, it, expect } from 'vitest'
import { addTombstones, applySyncDoc, dropTombstones, emptySyncDoc, mergeData, parseSyncDoc, syncFingerprint, toSyncDoc, type SyncDoc } from './sync'
import { normalizeData, normalizeDeleted } from './data'
import { bumpChanged, completeTask, normalizeTask, reorderTasks, touchTask } from './tasks'
import { markNagged, resetNag } from './reminder'
import { applyNotificationAction } from './stats'
import { DEFAULT_SETTINGS, FOCUS_LOG_MAX, TOMBSTONE_TTL_MS, type FocusEntry, type Task } from './types'

// Tuesday, 13 October 2026, 10:00 local time
const NOW = new Date(2026, 9, 13, 10, 0).getTime()
const MIN = 60_000
const DAY = 24 * 60 * MIN

const task = (o: Partial<Task> & { id: string }): Task => normalizeTask({ title: o.id, createdAt: NOW - DAY, order: NOW - DAY, updatedAt: NOW - DAY, ...o })
const entry = (o: Partial<FocusEntry> & { id: string }): FocusEntry => ({ taskId: 't1', phase: 'work', startedAt: NOW - 30 * MIN, endedAt: NOW, ...o })
const doc = (o: Partial<SyncDoc> = {}, deviceId = 'A'): SyncDoc => ({ ...emptySyncDoc(deviceId, NOW), ...o })
const ids = (d: SyncDoc) => d.tasks.map((t) => t.id)

describe('mergeData: tasks', () => {
  it('local-only task → stays, remote must be updated', () => {
    const r = mergeData(doc({ tasks: [task({ id: 'a' })] }), doc({}, 'B'), NOW)
    expect(ids(r.merged)).toEqual(['a'])
    expect(r.changedLocal).toBe(false)
    expect(r.changedRemote).toBe(true)
  })

  it('remote-only task → added locally, remote untouched', () => {
    const r = mergeData(doc(), doc({ tasks: [task({ id: 'b' })] }, 'B'), NOW)
    expect(ids(r.merged)).toEqual(['b'])
    expect(r.changedLocal).toBe(true)
    expect(r.changedRemote).toBe(false)
  })

  it('both edited: the newer updatedAt wins in either direction', () => {
    const older = task({ id: 'a', title: 'old', updatedAt: NOW - 2 * MIN })
    const newer = task({ id: 'a', title: 'new', updatedAt: NOW - MIN })
    const remoteWins = mergeData(doc({ tasks: [older] }), doc({ tasks: [newer] }, 'B'), NOW)
    expect(remoteWins.merged.tasks[0].title).toBe('new')
    expect(remoteWins.changedLocal).toBe(true)
    expect(remoteWins.changedRemote).toBe(true) // losing version is now preserved on both devices
    expect(remoteWins.merged.tasks[0].history[0].content.title).toBe('old')
    const localWins = mergeData(doc({ tasks: [newer] }), doc({ tasks: [older] }, 'B'), NOW)
    expect(localWins.merged.tasks[0].title).toBe('new')
    expect(localWins.changedLocal).toBe(true)
    expect(localWins.changedRemote).toBe(true)
  })

  it('tie on updatedAt → the local copy wins; an identical copy on both sides changes nothing', () => {
    const l = task({ id: 'a', title: 'mine', updatedAt: NOW })
    const r = task({ id: 'a', title: 'theirs', updatedAt: NOW })
    const tie = mergeData(doc({ tasks: [l] }), doc({ tasks: [r] }, 'B'), NOW)
    expect(tie.merged.tasks[0].title).toBe('mine')
    expect(tie.changedLocal).toBe(true)
    expect(tie.merged.tasks[0].history[0].content.title).toBe('theirs')
    expect(tie.changedRemote).toBe(true)
    // same content, different objects (one side parsed from JSON) → no change on either side
    const same = mergeData(doc({ tasks: [l] }), doc({ tasks: [JSON.parse(JSON.stringify(l))] }, 'B'), NOW)
    expect(same.changedLocal).toBe(false)
    expect(same.changedRemote).toBe(false)
  })

  it('keeps the local order and appends remote-only tasks', () => {
    const r = mergeData(doc({ tasks: [task({ id: 'b' }), task({ id: 'a' })] }), doc({ tasks: [task({ id: 'c' }), task({ id: 'a' })] }, 'B'), NOW)
    expect(ids(r.merged)).toEqual(['b', 'a', 'c'])
  })

  it('order conflicts simply follow the winning copy', () => {
    const l = task({ id: 'a', order: 1000, updatedAt: NOW - MIN })
    const r = task({ id: 'a', order: 5000, updatedAt: NOW })
    expect(mergeData(doc({ tasks: [l] }), doc({ tasks: [r] }, 'B'), NOW).merged.tasks[0].order).toBe(5000)
  })
})

describe('mergeData: tombstones', () => {
  it('deleted on one side after the other side edited it → gone on both', () => {
    const edited = task({ id: 'a', updatedAt: NOW - 2 * MIN })
    const r = mergeData(doc({ tasks: [edited] }), doc({ deleted: [{ id: 'a', at: NOW - MIN }] }, 'B'), NOW)
    expect(ids(r.merged)).toEqual([])
    expect(r.merged.deleted).toEqual([{ id: 'a', at: NOW - MIN }])
    expect(r.changedLocal).toBe(true)
    expect(r.changedRemote).toBe(false)
    // the other direction: local tombstone, remote still has the task
    const r2 = mergeData(doc({ deleted: [{ id: 'a', at: NOW - MIN }] }), doc({ tasks: [edited] }, 'B'), NOW)
    expect(ids(r2.merged)).toEqual([])
    expect(r2.changedLocal).toBe(false)
    expect(r2.changedRemote).toBe(true)
  })

  it('a tombstone with the same timestamp as the edit deletes (delete follows the edit)', () => {
    const r = mergeData(doc({ tasks: [task({ id: 'a', updatedAt: NOW })] }), doc({ deleted: [{ id: 'a', at: NOW }] }, 'B'), NOW)
    expect(ids(r.merged)).toEqual([])
  })

  it('edited after the delete → the task comes back and the tombstone is dropped on both sides', () => {
    const revived = task({ id: 'a', title: 'back', updatedAt: NOW })
    const r = mergeData(doc({ tasks: [revived] }), doc({ deleted: [{ id: 'a', at: NOW - MIN }] }, 'B'), NOW)
    expect(ids(r.merged)).toEqual(['a'])
    expect(r.merged.deleted).toEqual([])
    expect(r.changedLocal).toBe(false)
    expect(r.changedRemote).toBe(true)
  })

  it('completed on one side, deleted later on the other → deleted; reopened after the delete → kept open', () => {
    const done = task({ id: 'a', completedAt: NOW - 3 * MIN, updatedAt: NOW - 3 * MIN })
    const r = mergeData(doc({ tasks: [done] }), doc({ deleted: [{ id: 'a', at: NOW - 2 * MIN }] }, 'B'), NOW)
    expect(ids(r.merged)).toEqual([])
    const reopened = task({ id: 'a', completedAt: null, updatedAt: NOW - MIN })
    const r2 = mergeData(doc({ tasks: [reopened] }), doc({ deleted: [{ id: 'a', at: NOW - 2 * MIN }] }, 'B'), NOW)
    expect(r2.merged.tasks[0].completedAt).toBeNull()
  })

  it('reopened locally vs completed remotely: the later action wins', () => {
    const reopened = task({ id: 'a', completedAt: null, updatedAt: NOW - MIN })
    const completed = task({ id: 'a', completedAt: NOW - 2 * MIN, updatedAt: NOW - 2 * MIN })
    expect(mergeData(doc({ tasks: [reopened] }), doc({ tasks: [completed] }, 'B'), NOW).merged.tasks[0].completedAt).toBeNull()
    const completedLater = task({ id: 'a', completedAt: NOW, updatedAt: NOW })
    expect(mergeData(doc({ tasks: [reopened] }), doc({ tasks: [completedLater] }, 'B'), NOW).merged.tasks[0].completedAt).toBe(NOW)
  })

  it('tombstones are unioned (newest per id) and pruned after 30 days', () => {
    const old = { id: 'old', at: NOW - TOMBSTONE_TTL_MS - 1 }
    const r = mergeData(doc({ deleted: [{ id: 'x', at: NOW - 5 * MIN }, old] }), doc({ deleted: [{ id: 'x', at: NOW - MIN }, { id: 'y', at: NOW - 2 * MIN }] }, 'B'), NOW)
    expect(r.merged.deleted).toEqual([
      { id: 'x', at: NOW - MIN },
      { id: 'y', at: NOW - 2 * MIN },
    ])
    expect(r.changedLocal).toBe(true)
    expect(r.changedRemote).toBe(false)
  })
})

describe('mergeData: counters, focus log, focused flag', () => {
  it('dailyDone takes the maximum per day', () => {
    const r = mergeData(doc({ dailyDone: { '2026-10-12': 3, '2026-10-11': 1 } }), doc({ dailyDone: { '2026-10-12': 2, '2026-10-13': 4 } }, 'B'), NOW)
    expect(r.merged.dailyDone).toEqual({ '2026-10-12': 3, '2026-10-11': 1, '2026-10-13': 4 })
    expect(r.changedLocal).toBe(true)
    expect(r.changedRemote).toBe(true)
    const same = mergeData(doc({ dailyDone: { '2026-10-12': 3 } }), doc({ dailyDone: { '2026-10-12': 3 } }, 'B'), NOW)
    expect(same.changedLocal).toBe(false)
    expect(same.changedRemote).toBe(false)
  })

  it('focusLog is unioned by id, sorted by startedAt and capped at FOCUS_LOG_MAX (oldest dropped)', () => {
    const a = entry({ id: 'a', startedAt: NOW - 3 * MIN })
    const b = entry({ id: 'b', startedAt: NOW - 2 * MIN })
    const c = entry({ id: 'c', startedAt: NOW - MIN })
    const r = mergeData(doc({ focusLog: [c, a] }), doc({ focusLog: [b, a] }, 'B'), NOW)
    expect(r.merged.focusLog.map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(r.changedLocal).toBe(true)
    expect(r.changedRemote).toBe(true)

    const many = Array.from({ length: FOCUS_LOG_MAX }, (_, i) => entry({ id: 'e' + i, startedAt: NOW - (FOCUS_LOG_MAX - i) * MIN }))
    const big = mergeData(doc({ focusLog: many }), doc({ focusLog: [entry({ id: 'newest', startedAt: NOW })] }, 'B'), NOW)
    expect(big.merged.focusLog).toHaveLength(FOCUS_LOG_MAX)
    expect(big.merged.focusLog[0].id).toBe('e1')
    expect(big.merged.focusLog[FOCUS_LOG_MAX - 1].id).toBe('newest')
  })

  it('only the most recently updated task stays focused; the demoted one becomes newer than both copies', () => {
    const l = task({ id: 'a', focused: true, updatedAt: NOW - MIN })
    const r = task({ id: 'b', focused: true, updatedAt: NOW })
    const m = mergeData(doc({ tasks: [l] }), doc({ tasks: [r] }, 'B'), NOW)
    const a = m.merged.tasks.find((t) => t.id === 'a')!
    const b = m.merged.tasks.find((t) => t.id === 'b')!
    expect(b.focused).toBe(true)
    expect(a.focused).toBe(false)
    expect(a.updatedAt).toBe(NOW + 1)
    expect(m.changedLocal).toBe(true)
    expect(m.changedRemote).toBe(true)
  })
})

describe('mergeData: idempotence', () => {
  it('merge(merge(a, b), b) changes nothing locally and yields the same document', () => {
    const a = doc({
      tasks: [task({ id: 'x', title: 'x-local', updatedAt: NOW - MIN, focused: true }), task({ id: 'only-a' }), task({ id: 'gone', updatedAt: NOW - 5 * MIN })],
      deleted: [{ id: 'd1', at: NOW - 2 * MIN }],
      dailyDone: { '2026-10-12': 2 },
      focusLog: [entry({ id: 'e1' })],
    })
    const b = doc(
      {
        tasks: [task({ id: 'x', title: 'x-remote', updatedAt: NOW }), task({ id: 'only-b', focused: true, updatedAt: NOW - 2 * MIN })],
        deleted: [{ id: 'gone', at: NOW - MIN }],
        dailyDone: { '2026-10-12': 1, '2026-10-13': 1 },
        focusLog: [entry({ id: 'e2', startedAt: NOW - 10 * MIN })],
      },
      'B',
    )
    const first = mergeData(a, b, NOW)
    const second = mergeData(first.merged, b, NOW)
    expect(second.changedLocal).toBe(false)
    expect(second.merged.tasks).toEqual(first.merged.tasks)
    expect(second.merged.deleted).toEqual(first.merged.deleted)
    expect(second.merged.dailyDone).toEqual(first.merged.dailyDone)
    expect(second.merged.focusLog).toEqual(first.merged.focusLog)
    // and against the other input as well
    const third = mergeData(first.merged, a, NOW)
    expect(third.changedLocal).toBe(false)
    expect(third.merged.tasks).toEqual(first.merged.tasks)
  })
})

describe('toSyncDoc / applySyncDoc / parseSyncDoc', () => {
  it('toSyncDoc carries only the synced subset and prunes tombstones; applySyncDoc never touches settings or hyperFocus', () => {
    const data = normalizeData(
      {
        tasks: [task({ id: 'a' })],
        settings: { ...DEFAULT_SETTINGS, language: 'tr', funTitles: false },
        hyperFocus: { phase: 'work', round: 1, endsAt: NOW + MIN, pausedRemaining: null, taskId: 'a', startedAt: NOW },
        deleted: [{ id: 'old', at: NOW - TOMBSTONE_TTL_MS - 1 }, { id: 'new', at: NOW - MIN }],
        dailyDone: { '2026-10-12': 1 },
      },
      DEFAULT_SETTINGS,
      NOW - TOMBSTONE_TTL_MS, // keep the old tombstone through normalisation so toSyncDoc has something to prune
    )
    const d = toSyncDoc(data, 'dev', NOW)
    expect(d.deviceId).toBe('dev')
    expect(d.savedAt).toBe(NOW)
    expect(d.deleted).toEqual([{ id: 'new', at: NOW - MIN }])
    expect('settings' in d).toBe(false)
    expect('hyperFocus' in d).toBe(false)

    const incoming = doc({ tasks: [task({ id: 'b' })], dailyDone: { '2026-10-13': 2 }, focusLog: [entry({ id: 'e' })], deleted: [{ id: 'a', at: NOW }] }, 'B')
    const applied = applySyncDoc(data, incoming)
    expect(applied.settings).toBe(data.settings)
    expect(applied.hyperFocus).toBe(data.hyperFocus)
    expect(applied.tasks.map((t) => t.id)).toEqual(['b'])
    expect(applied.deleted).toEqual([{ id: 'a', at: NOW }])
    expect(applied.dailyDone).toEqual({ '2026-10-13': 2 })
    expect(applied.focusLog).toEqual([entry({ id: 'e' })])
  })

  it('parseSyncDoc normalises tasks, drops duplicates and garbage, and returns null for non-documents', () => {
    const raw = JSON.stringify({ version: 1, deviceId: 'B', savedAt: NOW, tasks: [{ id: 'a', title: 'A' }, { id: 'a', title: 'dup' }, { nope: 1 }, 'x'], deleted: [{ id: 'z', at: NOW }, { id: 5 }], dailyDone: { '2026-10-13': 1, bad: 2 }, focusLog: [entry({ id: 'e' }), { id: 'broken' }] })
    const d = parseSyncDoc(raw, NOW)!
    expect(d.tasks).toHaveLength(1)
    expect(d.tasks[0]).toMatchObject({ id: 'a', title: 'A', updatedAt: d.tasks[0].createdAt })
    expect(d.deleted).toEqual([{ id: 'z', at: NOW }])
    expect(d.dailyDone).toEqual({ '2026-10-13': 1 })
    expect(d.focusLog.map((e) => e.id)).toEqual(['e'])
    for (const bad of ['', 'not json', '[]', 'null', '{"tasks":"no"}', '{}']) expect(parseSyncDoc(bad, NOW)).toBeNull()
  })

  it('syncFingerprint ignores settings and hyperFocus but sees every synced field', () => {
    const data = normalizeData({ tasks: [task({ id: 'a' })] }, DEFAULT_SETTINGS, NOW)
    const fp = syncFingerprint(data)
    expect(syncFingerprint({ ...data, settings: { ...data.settings, language: 'ru' }, hyperFocus: null } as typeof data)).toBe(fp)
    expect(syncFingerprint({ ...data, tasks: [task({ id: 'a', title: 'edited' })] })).not.toBe(fp)
    expect(syncFingerprint({ ...data, deleted: [{ id: 'q', at: NOW }] })).not.toBe(fp)
    expect(syncFingerprint({ ...data, dailyDone: { '2026-10-13': 1 } })).not.toBe(fp)
    expect(syncFingerprint({ ...data, focusLog: [entry({ id: 'e' })] })).not.toBe(fp)
  })
})

describe('tombstone helpers and normalisation', () => {
  it('addTombstones / dropTombstones keep the list unique, sorted and pruned', () => {
    const d1 = addTombstones([], ['b', 'a'], NOW - MIN)
    expect(d1).toEqual([
      { id: 'a', at: NOW - MIN },
      { id: 'b', at: NOW - MIN },
    ])
    const d2 = addTombstones(d1, ['a'], NOW)
    expect(d2).toEqual([
      { id: 'a', at: NOW },
      { id: 'b', at: NOW - MIN },
    ])
    expect(addTombstones(d2, [], NOW)).toBe(d2)
    expect(dropTombstones(d2, ['a'])).toEqual([{ id: 'b', at: NOW - MIN }])
    expect(dropTombstones(d2, ['zzz'])).toBe(d2)
  })

  it('normalizeDeleted prunes after 30 days and normalizeData defaults `deleted` to []', () => {
    expect(normalizeDeleted([{ id: 'a', at: NOW - TOMBSTONE_TTL_MS + 1 }, { id: 'b', at: NOW - TOMBSTONE_TTL_MS - 1 }, { id: '', at: NOW }, { id: 'c', at: 'x' }, null], NOW)).toEqual([{ id: 'a', at: NOW - TOMBSTONE_TTL_MS + 1 }])
    expect(normalizeData({ tasks: [] }).deleted).toEqual([])
    expect(normalizeData({ tasks: [] }).settings.sync).toEqual({ mode: 'off', webdavUrl: '', folder: '' })
    expect(normalizeData({ tasks: [], settings: { sync: { mode: 'bogus' as never, webdavUrl: 'https://x/y.json', folder: 7 as never } } as never }).settings.sync).toEqual({ mode: 'off', webdavUrl: 'https://x/y.json', folder: '' })
  })
})

describe('updatedAt bookkeeping', () => {
  it('normalizeTask defaults updatedAt to createdAt and keeps a stored value', () => {
    expect(normalizeTask({ id: 'a', createdAt: 5 }).updatedAt).toBe(5)
    expect(normalizeTask({ id: 'a', createdAt: 5, updatedAt: 9 }).updatedAt).toBe(9)
    expect(normalizeTask({ id: 'a', createdAt: 5, updatedAt: 'x' as never }).updatedAt).toBe(5)
  })

  it('touchTask sets now, or one past a timestamp from the future (clock ahead elsewhere)', () => {
    const t = task({ id: 'a', updatedAt: NOW - MIN })
    expect(touchTask(t, NOW).updatedAt).toBe(NOW)
    expect(touchTask(task({ id: 'a', updatedAt: NOW + 5000 }), NOW).updatedAt).toBe(NOW + 5001)
    const already = task({ id: 'a', updatedAt: NOW })
    expect(touchTask(already, NOW)).not.toBe(already) // NOW + 1: an edit is always newer than the copy it is based on
    expect(touchTask(already, NOW).updatedAt).toBe(NOW + 1)
  })

  it('bumpChanged touches replaced or new tasks only and keeps identity when nothing changed', () => {
    const a = task({ id: 'a' })
    const b = task({ id: 'b' })
    const next = [a, { ...b, title: 'edited' }, task({ id: 'c' })]
    const out = bumpChanged([a, b], next, NOW)
    expect(out[0]).toBe(a)
    expect(out[1].updatedAt).toBe(NOW)
    expect(out[2].updatedAt).toBe(NOW)
    expect(bumpChanged([a, b], [a, b], NOW)).toEqual([a, b])
    expect(bumpChanged([a, b], [b, a], NOW)[0]).toBe(b)
  })

  it('completeTask, reorderTasks, markNagged, resetNag and notification actions touch exactly the changed tasks', () => {
    const a = task({ id: 'a', recurrence: 'daily', dueAt: NOW - DAY, nagCount: 2, updatedAt: 1 })
    const b = task({ id: 'b' })
    const before = Date.now() // completeTask uses the real clock
    const done = completeTask([a, b], 'a')
    expect(done.find((t) => t.id === 'a')!.updatedAt).toBeGreaterThanOrEqual(before)
    expect(done[0].id).not.toBe('a') // the spawned next occurrence
    expect(done[0].updatedAt).toBeGreaterThanOrEqual(before)
    expect(done.find((t) => t.id === 'b')).toBe(b)

    const c = task({ id: 'c', order: 3000 })
    const list = [task({ id: 'x', order: 1000 }), task({ id: 'y', order: 2000 }), c]
    const reordered = reorderTasks(list, 'c', 'x', undefined, NOW)
    expect(reordered.find((t) => t.id === 'c')!.updatedAt).toBe(NOW)
    expect(reordered.find((t) => t.id === 'x')!.updatedAt).toBe(NOW)
    expect(reordered.find((t) => t.id === 'y')!.updatedAt).toBe(NOW) // 2000 → 3000
    const noop = reorderTasks(list, 'c', null, undefined, NOW) // already last
    expect(noop.find((t) => t.id === 'c')).toBe(c)

    const nagged = markNagged([a, b], ['a'])
    expect(nagged[0].nagCount).toBe(3)
    expect(nagged[0].updatedAt).toBe(1) // a delivered reminder is not an edit: never wins a sync conflict
    expect(nagged[1]).toBe(b)
    // the safety net agrees: a nag-only replacement keeps its timestamp, a real change does not
    expect(bumpChanged([a, b], nagged, NOW)[0].updatedAt).toBe(1)
    expect(bumpChanged([a, b], [{ ...nagged[0], title: 'edited' }, b], NOW)[0].updatedAt).toBe(NOW)
    expect(resetNag(a, NOW).updatedAt).toBe(NOW)
    expect(resetNag(b, NOW)).toBe(b)

    const data = normalizeData({ tasks: [a, task({ id: 'f', focused: true })] }, DEFAULT_SETTINGS, NOW)
    const focused = applyNotificationAction(data, 'a', 'focus', NOW)
    expect(focused.tasks.find((t) => t.id === 'a')!.updatedAt).toBeGreaterThanOrEqual(NOW)
    expect(focused.tasks.find((t) => t.id === 'f')!.updatedAt).toBe(NOW)
    expect(applyNotificationAction(data, 'a', 'snooze30', NOW).tasks[0].updatedAt).toBeGreaterThanOrEqual(NOW)
  })
})

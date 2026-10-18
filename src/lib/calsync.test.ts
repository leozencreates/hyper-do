import { describe, it, expect } from 'vitest'
import { pushAction } from './calsync'

describe('pushAction (Google push of one desired task)', () => {
  it('insert without a known event, skip when unchanged, patch within the same kind', () => {
    expect(pushAction(undefined, 'fp', '')).toBe('insert')
    expect(pushAction({ eventId: '', fp: 'fp' }, 'fp', '')).toBe('insert')
    expect(pushAction({ eventId: 'e1', fp: 'fp' }, 'fp', '')).toBe('skip')
    expect(pushAction({ eventId: 'e1', fp: 'old' }, 'new', '')).toBe('patch')
    expect(pushAction({ eventId: 'e1', fp: 'old', rrule: 'FREQ=DAILY' }, 'new', 'FREQ=WEEKLY')).toBe('patch')
  })

  it('switching between a single event and a series recreates the event', () => {
    expect(pushAction({ eventId: 'e1', fp: 'old' }, 'new', 'FREQ=DAILY')).toBe('recreate')
    expect(pushAction({ eventId: 'e1', fp: 'old', rrule: 'FREQ=DAILY' }, 'new', '')).toBe('recreate')
    // entries stored before this change have no rrule field: they were single events
    expect(pushAction({ eventId: 'e1', fp: 'old', rrule: '' }, 'new', '')).toBe('patch')
  })
})

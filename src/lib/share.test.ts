import { describe, it, expect } from 'vitest'
import { SHARE_TITLE_MAX, parseShareEvent, shareToTaskFields } from './share'

describe('parseShareEvent', () => {
  it('reads text/subject copied onto the event by Capacitor', () => {
    expect(parseShareEvent({ type: 'hyperdoShare', text: 'https://example.com', subject: 'Example' })).toEqual({ text: 'https://example.com', subject: 'Example' })
  })

  it('accepts a JSON string or an object in `detail`', () => {
    expect(parseShareEvent({ detail: '{"text":"hello","subject":"s"}' })).toEqual({ text: 'hello', subject: 's' })
    expect(parseShareEvent({ detail: { text: 'hello' } })).toEqual({ text: 'hello' })
    expect(parseShareEvent({ detail: 'plain text' })).toEqual({ text: 'plain text' })
  })

  it('drops blank subjects and returns null when nothing is shared', () => {
    expect(parseShareEvent({ text: 'x', subject: '   ' })).toEqual({ text: 'x' })
    expect(parseShareEvent({ text: '   ' })).toBeNull()
    expect(parseShareEvent({})).toBeNull()
    expect(parseShareEvent(null)).toBeNull()
    expect(parseShareEvent('str')).toBeNull()
  })
})

describe('shareToTaskFields', () => {
  it('subject becomes the title, the full text goes to the notes', () => {
    expect(shareToTaskFields({ text: 'Look at this\nhttps://example.com/page', subject: 'Example page' })).toEqual({ title: 'Example page', notes: 'Look at this\nhttps://example.com/page' })
  })

  it('without a subject the first non-empty line is the title', () => {
    expect(shareToTaskFields({ text: '\n\n  Buy milk  \nand eggs\n' })).toEqual({ title: 'Buy milk', notes: 'Buy milk  \nand eggs' })
  })

  it('a shared URL alone is both title and notes', () => {
    expect(shareToTaskFields({ text: 'https://example.com/a' })).toEqual({ title: 'https://example.com/a', notes: 'https://example.com/a' })
  })

  it('cuts long titles to SHARE_TITLE_MAX with an ellipsis and normalises CRLF', () => {
    const long = 'x'.repeat(300)
    const r = shareToTaskFields({ text: long + '\r\nsecond' })
    expect(r.title).toHaveLength(SHARE_TITLE_MAX)
    expect(r.title.endsWith('…')).toBe(true)
    expect(r.notes).toBe(long + '\nsecond')
  })
})

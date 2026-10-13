import { describe, it, expect } from 'vitest'
import { parseQuickAdd, splitBrainDump } from './parse'

// Tuesday, 13 October 2026, 10:00 local time
const NOW = new Date(2026, 9, 13, 10, 0).getTime()
/** Local-time helper: day of October 2026 at hh:mm unless month/year are given. */
const at = (day: number, h: number, m: number, month = 9, year = 2026) => new Date(year, month, day, h, m).getTime()
const parse = (s: string) => parseQuickAdd(s, 'en', NOW)

describe('parseQuickAdd: title', () => {
  it('keeps the remaining words as the title with original casing and collapsed whitespace', () => {
    const p = parse('  Pay   the Bill  ')
    expect(p.title).toBe('Pay the Bill')
    expect(p.dueAt).toBeNull()
    expect(p.priority).toBeNull()
    expect(p.tags).toEqual([])
    expect(p.remindEveryMin).toBeNull()
  })

  it('returns an empty result for empty input', () => {
    expect(parse('')).toEqual({ title: '', dueAt: null, priority: null, tags: [], remindEveryMin: null, estimateMin: null, energy: null, recurrence: null, recurrenceRule: null })
  })

  it('leaves lone "#" and "!" and invalid numbers in the title', () => {
    expect(parse('# ! 25:00 32.10 15.60 x').title).toBe('# ! 25:00 32.10 15.60 x')
  })

  it('a dotted number with an impossible month is read as a time (15.13 → 15:13)', () => {
    expect(parse('15.13 x').dueAt).toBe(at(13, 15, 13))
  })

  it('does not treat Object.prototype names as weekday or priority keywords', () => {
    const p = parse('fix the constructor !toString')
    expect(p.title).toBe('fix the constructor !toString')
    expect(p.dueAt).toBeNull()
    expect(p.priority).toBeNull()
  })
})

describe('parseQuickAdd: #tags', () => {
  it('collects several tags, lower-cases them and strips trailing punctuation', () => {
    const p = parse('pay bill #Home #work. #ev,')
    expect(p.tags).toEqual(['home', 'work', 'ev'])
    expect(p.title).toBe('pay bill')
  })
})

describe('parseQuickAdd: !priority', () => {
  it('maps !1 !2 !3 to high / medium / low', () => {
    expect(parse('a !1').priority).toBe('high')
    expect(parse('a !2').priority).toBe('medium')
    expect(parse('a !3').priority).toBe('low')
  })

  it('accepts Turkish, English and Russian words', () => {
    expect(parse('a !yüksek').priority).toBe('high')
    expect(parse('a !yuksek').priority).toBe('high')
    expect(parse('a !orta').priority).toBe('medium')
    expect(parse('a !düşük').priority).toBe('low')
    expect(parse('a !high').priority).toBe('high')
    expect(parse('a !med').priority).toBe('medium')
    expect(parse('a !low').priority).toBe('low')
    expect(parse('a !высокий').priority).toBe('high')
    expect(parse('a !средний').priority).toBe('medium')
    expect(parse('a !низкий').priority).toBe('low')
    expect(parse('a !HIGH').priority).toBe('high')
  })

  it('leaves unknown priority words in the title', () => {
    const p = parse('a !urgent')
    expect(p.priority).toBeNull()
    expect(p.title).toBe('a !urgent')
  })
})

describe('parseQuickAdd: @reminder interval', () => {
  it('reads minutes in every spelling and defaults to minutes', () => {
    expect(parse('a @30dk').remindEveryMin).toBe(30)
    expect(parse('a @45m').remindEveryMin).toBe(45)
    expect(parse('a @15min').remindEveryMin).toBe(15)
    expect(parse('a @15мин').remindEveryMin).toBe(15)
    expect(parse('a @25').remindEveryMin).toBe(25)
  })

  it('converts hours to minutes', () => {
    expect(parse('a @2sa').remindEveryMin).toBe(120)
    expect(parse('a @2h').remindEveryMin).toBe(120)
    expect(parse('a @1s').remindEveryMin).toBe(60)
    expect(parse('a @3ч').remindEveryMin).toBe(180)
  })

  it('@0 turns reminders off', () => {
    expect(parse('a @0').remindEveryMin).toBe(0)
  })
})

describe('parseQuickAdd: ~estimate', () => {
  it('reads minutes and hours with the same unit table as @', () => {
    expect(parse('a ~30m').estimateMin).toBe(30)
    expect(parse('a ~45dk').estimateMin).toBe(45)
    expect(parse('a ~90мин').estimateMin).toBe(90)
    expect(parse('a ~25').estimateMin).toBe(25)
    expect(parse('a ~2h').estimateMin).toBe(120)
    expect(parse('a ~1sa').estimateMin).toBe(60)
    expect(parse('a ~2ч').estimateMin).toBe(120)
  })

  it('~0 and non-numeric ~words stay in the title; the estimate does not touch the reminder interval', () => {
    expect(parse('a ~0')).toMatchObject({ title: 'a ~0', estimateMin: null })
    expect(parse('~later a')).toMatchObject({ title: '~later a', estimateMin: null })
    expect(parse('a ~30m')).toMatchObject({ remindEveryMin: null, title: 'a' })
  })
})

describe('parseQuickAdd: ^energy', () => {
  it('English, Turkish and Russian words (case-insensitive)', () => {
    expect(parse('a ^low').energy).toBe('low')
    expect(parse('a ^med').energy).toBe('medium')
    expect(parse('a ^medium').energy).toBe('medium')
    expect(parse('a ^high').energy).toBe('high')
    expect(parse('a ^düşük').energy).toBe('low')
    expect(parse('a ^dusuk').energy).toBe('low')
    expect(parse('a ^orta').energy).toBe('medium')
    expect(parse('a ^yüksek').energy).toBe('high')
    expect(parse('a ^yuksek').energy).toBe('high')
    expect(parse('a ^низкая').energy).toBe('low')
    expect(parse('a ^средняя').energy).toBe('medium')
    expect(parse('a ^высокая').energy).toBe('high')
    expect(parse('a ^HIGH').energy).toBe('high')
  })

  it('unknown ^words and a lone ^ stay in the title', () => {
    expect(parse('a ^tired')).toMatchObject({ title: 'a ^tired', energy: null })
    expect(parse('a ^ b')).toMatchObject({ title: 'a ^ b', energy: null })
    expect(parse('a ^toString')).toMatchObject({ title: 'a ^toString', energy: null })
  })
})

describe('splitBrainDump', () => {
  it('one entry per non-empty line, trimmed, CRLF tolerant', () => {
    expect(splitBrainDump('call mom\r\n\n  pay bill  \n\n')).toEqual(['call mom', 'pay bill'])
    expect(splitBrainDump('')).toEqual([])
    expect(splitBrainDump('   \n \n')).toEqual([])
  })

  it('strips leading bullets: - * • 1. 1)', () => {
    expect(splitBrainDump('- a\n* b\n• c\n1. d\n12) e\n3.f')).toEqual(['a', 'b', 'c', 'd', 'e', '3.f'])
  })

  it('keeps dashes and numbers that are part of the text', () => {
    expect(splitBrainDump('-5 degrees outside\n1.5 hours of reading\nfix a-b')).toEqual(['-5 degrees outside', '1.5 hours of reading', 'fix a-b'])
  })

  it('quick-add tokens survive on each line', () => {
    const lines = splitBrainDump('- tomorrow 18:00 pay bill #home\n- ~30m tidy desk ^low')
    expect(parse(lines[0])).toMatchObject({ title: 'pay bill', tags: ['home'] })
    expect(parse(lines[1])).toMatchObject({ title: 'tidy desk', estimateMin: 30, energy: 'low' })
  })
})

describe('parseQuickAdd: day keywords', () => {
  it('today → 23:59 of today in TR / EN / RU', () => {
    for (const w of ['bugün', 'bugun', 'today', 'сегодня']) expect(parse(`${w} x`).dueAt).toBe(at(13, 23, 59))
  })

  it('tomorrow → 23:59 of tomorrow in TR / EN / RU', () => {
    for (const w of ['yarın', 'yarin', 'tomorrow', 'завтра']) expect(parse(`${w} x`).dueAt).toBe(at(14, 23, 59))
  })

  it('weekday names resolve to the next such day (TR / EN / RU, short forms too)', () => {
    for (const w of ['friday', 'fri', 'cuma', 'пятница', 'пт']) expect(parse(`${w} x`).dueAt).toBe(at(16, 23, 59))
    for (const w of ['monday', 'mon', 'pazartesi', 'понедельник', 'пн']) expect(parse(`${w} x`).dueAt).toBe(at(19, 23, 59))
  })

  it("today's weekday name means next week, not today", () => {
    expect(parse('tuesday x').dueAt).toBe(at(20, 23, 59))
    expect(parse('salı x').dueAt).toBe(at(20, 23, 59))
  })
})

describe('parseQuickAdd: dd.mm dates', () => {
  it('dd.mm and dd/mm are day.month in the current year', () => {
    expect(parse('15.10 x').dueAt).toBe(at(15, 23, 59))
    expect(parse('15/10 x').dueAt).toBe(at(15, 23, 59))
    expect(parse('5.11 x').dueAt).toBe(at(5, 23, 59, 10))
  })

  it("today's date stays this year", () => {
    expect(parse('13.10 x').dueAt).toBe(at(13, 23, 59))
  })

  it('a dd.mm already in the past rolls over to next year', () => {
    expect(parse('1.10 x').dueAt).toBe(at(1, 23, 59, 9, 2027))
    expect(parse('12.10 x').dueAt).toBe(at(12, 23, 59, 9, 2027))
  })

  it('an explicit year is used as is (2- and 4-digit), even in the past', () => {
    expect(parse('15.10.2027 x').dueAt).toBe(at(15, 23, 59, 9, 2027))
    expect(parse('15.10.27 x').dueAt).toBe(at(15, 23, 59, 9, 2027))
    expect(parse('15.1.2026 x').dueAt).toBe(at(15, 23, 59, 0, 2026))
  })

  it('a dotted number that fits both forms is a date, not a time (10.12 = 10 December)', () => {
    expect(parse('10.12 x').dueAt).toBe(at(10, 23, 59, 11))
  })
})

describe('parseQuickAdd: times', () => {
  it('a future time without a day is today', () => {
    expect(parse('18:00 x').dueAt).toBe(at(13, 18, 0))
    expect(parse('18.30 x').dueAt).toBe(at(13, 18, 30))
  })

  it('a time already in the past (or exactly now) is tomorrow', () => {
    expect(parse('09:00 x').dueAt).toBe(at(14, 9, 0))
    expect(parse('10:00 x').dueAt).toBe(at(14, 10, 0))
  })

  it('day + time combine; an explicit day keeps a past time', () => {
    expect(parse('tomorrow 18:00 x').dueAt).toBe(at(14, 18, 0))
    expect(parse('today 09:00 x').dueAt).toBe(at(13, 9, 0))
    expect(parse('friday 18:00 x').dueAt).toBe(at(16, 18, 0))
    expect(parse('15.10 08:15 x').dueAt).toBe(at(15, 8, 15))
  })
})

describe('parseQuickAdd: relative offsets (EN "in …")', () => {
  it('in 30m / 30min / 2h / 3d / 1w → now + offset, not end of day', () => {
    expect(parse('in 30m x')).toMatchObject({ dueAt: at(13, 10, 30), title: 'x' })
    expect(parse('in 30min x').dueAt).toBe(at(13, 10, 30))
    expect(parse('in 2h x').dueAt).toBe(at(13, 12, 0))
    expect(parse('in 3d x').dueAt).toBe(at(16, 10, 0))
    expect(parse('in 1w x').dueAt).toBe(at(20, 10, 0))
  })

  it('in 2 hours / in 3 days / in an hour (separate unit word)', () => {
    expect(parse('call mom in 2 hours')).toMatchObject({ dueAt: at(13, 12, 0), title: 'call mom' })
    expect(parse('in 3 days x').dueAt).toBe(at(16, 10, 0))
    expect(parse('in an hour x').dueAt).toBe(at(13, 11, 0))
    expect(parse('in 1 week x').dueAt).toBe(at(20, 10, 0))
  })

  it('seconds are zeroed; an explicit time moves the clock on the offset day', () => {
    const nowWithSeconds = new Date(2026, 9, 13, 10, 0, 45).getTime()
    expect(parseQuickAdd('in 30m x', 'en', nowWithSeconds).dueAt).toBe(at(13, 10, 30))
    expect(parse('in 3 days 18:00 x').dueAt).toBe(at(16, 18, 0))
  })

  it('"in" without an amount, or an amount without a unit, stays in the title', () => {
    expect(parse('check in with bob')).toMatchObject({ title: 'check in with bob', dueAt: null })
    expect(parse('in 30 x')).toMatchObject({ title: 'in 30 x', dueAt: null })
    expect(parse('buy 5 apples in 2 rooms')).toMatchObject({ title: 'buy 5 apples in 2 rooms', dueAt: null })
  })
})

describe('parseQuickAdd: relative offsets (TR "… sonra")', () => {
  it('30dk sonra / 2 saat sonra / 3 gün sonra / 1 hafta sonra', () => {
    expect(parse('30dk sonra x')).toMatchObject({ dueAt: at(13, 10, 30), title: 'x' })
    expect(parse('anneyi ara 2 saat sonra')).toMatchObject({ dueAt: at(13, 12, 0), title: 'anneyi ara' })
    expect(parse('3 gün sonra x').dueAt).toBe(at(16, 10, 0))
    expect(parse('1 hafta sonra x').dueAt).toBe(at(20, 10, 0))
    expect(parse('bir saat sonra x').dueAt).toBe(at(13, 11, 0))
  })

  it('yarım saat sonra = 30 minutes', () => {
    expect(parse('yarım saat sonra x')).toMatchObject({ dueAt: at(13, 10, 30), title: 'x' })
  })

  it('"sonra" alone stays in the title', () => {
    expect(parse('sonra bakarım')).toMatchObject({ title: 'sonra bakarım', dueAt: null })
  })
})

describe('parseQuickAdd: relative offsets (RU "через …")', () => {
  it('через 30 мин / 2 ч / 2 часа / 3 дня / 3 дней / неделю / час', () => {
    expect(parse('через 30 мин x')).toMatchObject({ dueAt: at(13, 10, 30), title: 'x' })
    expect(parse('через 2 ч x').dueAt).toBe(at(13, 12, 0))
    expect(parse('позвонить маме через 2 часа')).toMatchObject({ dueAt: at(13, 12, 0), title: 'позвонить маме' })
    expect(parse('через 3 дня x').dueAt).toBe(at(16, 10, 0))
    expect(parse('через 3 дней x').dueAt).toBe(at(16, 10, 0))
    expect(parse('через неделю x').dueAt).toBe(at(20, 10, 0))
    expect(parse('через час x').dueAt).toBe(at(13, 11, 0))
  })
})

describe('parseQuickAdd: next week / next <weekday>', () => {
  it('next week / haftaya / gelecek hafta / на следующей неделе → Monday of next week, 23:59', () => {
    for (const s of ['next week', 'haftaya', 'gelecek hafta', 'önümüzdeki hafta', 'на следующей неделе']) {
      expect(parse(`${s} x`), s).toMatchObject({ dueAt: at(19, 23, 59), title: 'x' })
    }
  })

  it('next week + time keeps the time', () => {
    expect(parse('next week 09:00 x').dueAt).toBe(at(19, 9, 0))
  })

  it('next <weekday> is that weekday of next week, not the upcoming one (EN)', () => {
    expect(parse('next monday x')).toMatchObject({ dueAt: at(19, 23, 59), title: 'x' })
    expect(parse('next friday x').dueAt).toBe(at(23, 23, 59))
    expect(parse('friday x').dueAt).toBe(at(16, 23, 59)) // plain weekday keeps today's behaviour
    expect(parse('next sunday x').dueAt).toBe(at(25, 23, 59))
    expect(parse('next tue 18:00 x').dueAt).toBe(at(20, 18, 0))
  })

  it('gelecek pazartesi / önümüzdeki salı (TR)', () => {
    expect(parse('gelecek pazartesi x')).toMatchObject({ dueAt: at(19, 23, 59), title: 'x' })
    expect(parse('önümüzdeki salı x').dueAt).toBe(at(20, 23, 59))
    expect(parse('önümüzdeki cuma x').dueAt).toBe(at(23, 23, 59))
  })

  it('в следующий понедельник / в следующую пятницу (RU, with or without "в")', () => {
    expect(parse('в следующий понедельник x')).toMatchObject({ dueAt: at(19, 23, 59), title: 'x' })
    expect(parse('в следующую пятницу x').dueAt).toBe(at(23, 23, 59))
    expect(parse('следующий понедельник x').dueAt).toBe(at(19, 23, 59))
    expect(parse('в пятницу x')).toMatchObject({ dueAt: at(16, 23, 59), title: 'x' }) // "в" + plain weekday
  })

  it('"next" without a known word stays in the title', () => {
    expect(parse('next step')).toMatchObject({ title: 'next step', dueAt: null })
  })
})

describe('parseQuickAdd: month names', () => {
  it('15 oct / oct 15 / 15 october (EN)', () => {
    expect(parse('15 oct x')).toMatchObject({ dueAt: at(15, 23, 59), title: 'x' })
    expect(parse('oct 15 x')).toMatchObject({ dueAt: at(15, 23, 59), title: 'x' })
    expect(parse('15 october x').dueAt).toBe(at(15, 23, 59))
    expect(parse('october 15th x').dueAt).toBe(at(15, 23, 59))
    expect(parse('5 nov x').dueAt).toBe(at(5, 23, 59, 10))
  })

  it('15 ekim / 15 eki (TR, incl. dotted capital İ)', () => {
    expect(parse('15 ekim x')).toMatchObject({ dueAt: at(15, 23, 59), title: 'x' })
    expect(parse('15 eki x').dueAt).toBe(at(15, 23, 59))
    expect(parse('15 EKİM x').dueAt).toBe(at(15, 23, 59))
    expect(parse('1 kasım x').dueAt).toBe(at(1, 23, 59, 10))
  })

  it('15 окт / 15 октября (RU)', () => {
    expect(parse('15 окт x')).toMatchObject({ dueAt: at(15, 23, 59), title: 'x' })
    expect(parse('15 октября x').dueAt).toBe(at(15, 23, 59))
    expect(parse('1 ноября x').dueAt).toBe(at(1, 23, 59, 10))
  })

  it('optional year, case-insensitive, combines with a time', () => {
    expect(parse('15 oct 2027 x')).toMatchObject({ dueAt: at(15, 23, 59, 9, 2027), title: 'x' })
    expect(parse('Oct 15 2027 x').dueAt).toBe(at(15, 23, 59, 9, 2027))
    expect(parse('15 OCT x').dueAt).toBe(at(15, 23, 59))
    expect(parse('15 oct 18:00 x').dueAt).toBe(at(15, 18, 0))
    expect(parse('1 oct 2026 x').dueAt).toBe(at(1, 23, 59)) // explicit year is used as is, even in the past
  })

  it('past dates without a year roll to next year; today stays this year', () => {
    expect(parse('1 oct x').dueAt).toBe(at(1, 23, 59, 9, 2027))
    expect(parse('5 may x').dueAt).toBe(at(5, 23, 59, 4, 2027))
    expect(parse('13 oct x').dueAt).toBe(at(13, 23, 59))
  })

  it('impossible dates and bare month names stay in the title; dd.mm keeps working', () => {
    expect(parse('31 feb x')).toMatchObject({ title: '31 feb x', dueAt: null })
    expect(parse('may call mom')).toMatchObject({ title: 'may call mom', dueAt: null })
    expect(parse('15.10 x').dueAt).toBe(at(15, 23, 59))
  })

  it('month-first order is English only: TR "ara" (= call) before a number is not December', () => {
    expect(parse('ara 2 kişiyi')).toMatchObject({ title: 'ara 2 kişiyi', dueAt: null })
    expect(parse('ekim 15 x')).toMatchObject({ title: 'ekim 15 x', dueAt: null })
    expect(parse('2 ara x').dueAt).toBe(at(2, 23, 59, 11))
  })
})

describe('parseQuickAdd: 12-hour times', () => {
  it('5pm / 5:30pm / 11am / 12am / 12pm', () => {
    expect(parse('5pm x')).toMatchObject({ dueAt: at(13, 17, 0), title: 'x' })
    expect(parse('5:30pm x').dueAt).toBe(at(13, 17, 30))
    expect(parse('11am x').dueAt).toBe(at(13, 11, 0))
    expect(parse('12am x').dueAt).toBe(at(14, 0, 0)) // 00:00 today is past → tomorrow
    expect(parse('12pm x').dueAt).toBe(at(13, 12, 0))
    expect(parse('5 pm x')).toMatchObject({ dueAt: at(13, 17, 0), title: 'x' })
    expect(parse('tomorrow 5pm x').dueAt).toBe(at(14, 17, 0))
    expect(parse('9am x').dueAt).toBe(at(14, 9, 0)) // already past today
  })

  it('noon / midnight (EN)', () => {
    expect(parse('noon x')).toMatchObject({ dueAt: at(13, 12, 0), title: 'x' })
    expect(parse('midnight x').dueAt).toBe(at(14, 0, 0))
    expect(parse('friday midnight x').dueAt).toBe(at(16, 0, 0))
  })

  it('öğlen / gece yarısı (TR)', () => {
    expect(parse('öğlen x')).toMatchObject({ dueAt: at(13, 12, 0), title: 'x' })
    expect(parse('gece yarısı x')).toMatchObject({ dueAt: at(14, 0, 0), title: 'x' })
  })

  it('полдень / полночь (RU)', () => {
    expect(parse('полдень x')).toMatchObject({ dueAt: at(13, 12, 0), title: 'x' })
    expect(parse('полночь x').dueAt).toBe(at(14, 0, 0))
  })

  it('invalid 12-hour values stay in the title', () => {
    expect(parse('13pm x')).toMatchObject({ title: '13pm x', dueAt: null })
    expect(parse('0am x')).toMatchObject({ title: '0am x', dueAt: null })
  })
})

describe('parseQuickAdd: *recurrence', () => {
  it('*daily *weekdays *weekly *monthly *yearly (EN); no date → today 23:59', () => {
    expect(parse('*daily water plants')).toMatchObject({ recurrence: 'daily', recurrenceRule: null, dueAt: at(13, 23, 59), title: 'water plants' })
    expect(parse('*weekdays x').recurrence).toBe('weekdays')
    expect(parse('*weekly x').recurrence).toBe('weekly')
    expect(parse('*monthly x').recurrence).toBe('monthly')
    expect(parse('*yearly x').recurrence).toBe('yearly')
    expect(parse('*DAILY x').recurrence).toBe('daily')
  })

  it('*every 3d / 2w / 2m / 1y, also *every3d and *every 2 weeks (EN)', () => {
    expect(parse('*every 3d x')).toMatchObject({ recurrence: 'custom', recurrenceRule: { every: 3, unit: 'day' }, title: 'x' })
    expect(parse('*every3d x')).toMatchObject({ recurrence: 'custom', recurrenceRule: { every: 3, unit: 'day' }, title: 'x' })
    expect(parse('*every 2w x').recurrenceRule).toEqual({ every: 2, unit: 'week' })
    expect(parse('*every 2m x').recurrenceRule).toEqual({ every: 2, unit: 'month' })
    expect(parse('*every 2 weeks x')).toMatchObject({ recurrenceRule: { every: 2, unit: 'week' }, title: 'x' })
    expect(parse('*every 1y x')).toMatchObject({ recurrence: 'yearly', recurrenceRule: null }) // every 1 unit = the plain recurrence
    expect(parse('*every 1d x')).toMatchObject({ recurrence: 'daily', recurrenceRule: null })
  })

  it('TR: *günlük *gunluk *haftaiçi *hafta-içi *haftalık *haftalik *aylık *aylik *yıllık *yillik, *her 3g|2h|2a|1y', () => {
    expect(parse('*günlük x').recurrence).toBe('daily')
    expect(parse('*gunluk x').recurrence).toBe('daily')
    expect(parse('*haftaiçi x').recurrence).toBe('weekdays')
    expect(parse('*hafta-içi x').recurrence).toBe('weekdays')
    expect(parse('*haftalık x').recurrence).toBe('weekly')
    expect(parse('*haftalik x').recurrence).toBe('weekly')
    expect(parse('*aylık x').recurrence).toBe('monthly')
    expect(parse('*aylik x').recurrence).toBe('monthly')
    expect(parse('*yıllık x').recurrence).toBe('yearly')
    expect(parse('*yillik x').recurrence).toBe('yearly')
    expect(parse('*her 3g x')).toMatchObject({ recurrence: 'custom', recurrenceRule: { every: 3, unit: 'day' }, title: 'x' })
    expect(parse('*her 2h x').recurrenceRule).toEqual({ every: 2, unit: 'week' })
    expect(parse('*her 2a x').recurrenceRule).toEqual({ every: 2, unit: 'month' })
    expect(parse('*her 1y x')).toMatchObject({ recurrence: 'yearly', recurrenceRule: null })
  })

  it('RU: *ежедневно *будни *еженедельно *ежемесячно *ежегодно, *каждые 3д|2н|2м|1г', () => {
    expect(parse('*ежедневно x').recurrence).toBe('daily')
    expect(parse('*будни x').recurrence).toBe('weekdays')
    expect(parse('*еженедельно x').recurrence).toBe('weekly')
    expect(parse('*ежемесячно x').recurrence).toBe('monthly')
    expect(parse('*ежегодно x').recurrence).toBe('yearly')
    expect(parse('*каждые 3д x')).toMatchObject({ recurrence: 'custom', recurrenceRule: { every: 3, unit: 'day' }, title: 'x' })
    expect(parse('*каждые 2н x').recurrenceRule).toEqual({ every: 2, unit: 'week' })
    expect(parse('*каждые 2м x').recurrenceRule).toEqual({ every: 2, unit: 'month' })
    expect(parse('*каждые 1г x')).toMatchObject({ recurrence: 'yearly', recurrenceRule: null })
  })

  it('an explicit date or time stays the anchor', () => {
    expect(parse('*weekly friday x').dueAt).toBe(at(16, 23, 59))
    expect(parse('*daily 09:00 x').dueAt).toBe(at(14, 9, 0))
  })

  it('unknown *words and a lone * stay in the title', () => {
    expect(parse('*foo x')).toMatchObject({ title: '*foo x', recurrence: null })
    expect(parse('a * b')).toMatchObject({ title: 'a * b', recurrence: null, dueAt: null })
    expect(parse('*every x')).toMatchObject({ title: '*every x', recurrence: null })
    expect(parse('*every 3 x')).toMatchObject({ title: '*every 3 x', recurrence: null })
  })
})

describe('parseQuickAdd: full examples', () => {
  it('Turkish README example', () => {
    const p = parse('yarın 18:00 fatura öde #ev !1 @30dk')
    expect(p).toEqual({ title: 'fatura öde', dueAt: at(14, 18, 0), priority: 'high', tags: ['ev'], remindEveryMin: 30, estimateMin: null, energy: null, recurrence: null, recurrenceRule: null })
  })

  it('English README example', () => {
    const p = parse('tomorrow 18:00 pay the bill #home !1 @30m')
    expect(p).toEqual({ title: 'pay the bill', dueAt: at(14, 18, 0), priority: 'high', tags: ['home'], remindEveryMin: 30, estimateMin: null, energy: null, recurrence: null, recurrenceRule: null })
  })

  it('Russian example', () => {
    const p = parse('завтра 18:00 оплатить счёт #дом !высокий @2ч')
    expect(p).toEqual({ title: 'оплатить счёт', dueAt: at(14, 18, 0), priority: 'high', tags: ['дом'], remindEveryMin: 120, estimateMin: null, energy: null, recurrence: null, recurrenceRule: null })
  })

  it('everything at once, including estimate, energy and recurrence', () => {
    const p = parse('tomorrow 18:00 pay the bill #home !1 @30m ~1h ^low *every 2w')
    expect(p).toEqual({ title: 'pay the bill', dueAt: at(14, 18, 0), priority: 'high', tags: ['home'], remindEveryMin: 30, estimateMin: 60, energy: 'low', recurrence: 'custom', recurrenceRule: { every: 2, unit: 'week' } })
  })

  it('keywords are case-insensitive', () => {
    const p = parse('TOMORROW 18:00 Call Mom #Family !Low')
    expect(p.title).toBe('Call Mom')
    expect(p.dueAt).toBe(at(14, 18, 0))
    expect(p.tags).toEqual(['family'])
    expect(p.priority).toBe('low')
  })
})

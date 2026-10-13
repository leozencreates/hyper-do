/**
 * Doğal dilli hızlı ekleme.
 *   "yarın 18:00 fatura öde #ev !1 @30dk"
 *   → başlık "fatura öde", son tarih yarın 18:00, etiket ev, öncelik yüksek, 30 dk'da bir hatırlat
 *
 * Desteklenen parçalar (TR/EN/RU):
 *   #etiket           etiket
 *   !1 !2 !3          öncelik (yüksek / orta / düşük) — !yüksek !high !высокий gibi kelimeler de olur
 *   @30dk @45m @2sa   hatırlatma aralığı; @0 kapatır
 *   ~30m ~2h ~45dk    süre tahmini (aynı birim tablosu)
 *   ^low ^med ^high   enerji (TR ^düşük ^orta ^yüksek, RU ^низкая ^средняя ^высокая)
 *   *daily *weekly    tekrar: *daily *weekdays *weekly *monthly *yearly, *every 3d|2w|2m|1y (*every3d da olur)
 *                     TR *günlük *haftaiçi *haftalık *aylık *yıllık *her 3g|2h|2a|1y
 *                     RU *ежедневно *будни *еженедельно *ежемесячно *ежегодно *каждые 3д|2н|2м|1г
 *   in 30m / in 2 hours / in 3 days / in 1w     göreli süre: şu an + süre (dakika hassasiyeti)
 *   30dk sonra / 2 saat sonra / yarım saat sonra / 3 gün sonra / 1 hafta sonra
 *   через 30 мин / через 2 часа / через 3 дня / через неделю
 *   bugün yarın       gün
 *   pazartesi … pazar hafta günü (sıradaki); RU "в пятницу" da olur
 *   next week / haftaya / gelecek hafta / на следующей неделе        gelecek haftanın pazartesisi
 *   next monday / gelecek pazartesi / önümüzdeki salı / в следующий понедельник   gelecek haftanın o günü
 *   15.10 / 15/10     gün.ay (gerekirse ay.gün değil, her zaman gün.ay)
 *   15 oct / oct 15 / 15 ekim / 15 eki / 15 окт / 15 октября [2027]   ay adıyla tarih (ay önce gelirse yalnız İngilizce)
 *   18:00 / 18.30     saat; 5pm 5:30pm 11am 12am(00:00) 12pm(12:00); noon midnight öğlen "gece yarısı" полдень полночь
 * Saat verilmeyen günler 23:59'a kurulur; gün verilmeyen saat bugüne (geçmişse yarına) kurulur.
 * Tarihsiz bir tekrar bugün 23:59'a kurulur (serinin bir çıpası olsun diye).
 *
 * Birden çok kelimelik ifadeler için küçük bir "phrase matcher" vardır: her eşleştirici `lw` (küçük harfli kelimeler)
 * ve `i` alır, 1–3 kelime ileri bakar ve tükettiği kelime sayısını döndürür; tüketilen kelimeler başlığa girmez.
 */
import type { Lang } from './i18n'
import type { Energy, Priority, Recurrence, RecurrenceRule, RecurrenceUnit } from './types'
import { DAY, endOfDay, startOfDay } from './dates'

export interface ParsedQuickAdd {
  title: string
  dueAt: number | null
  priority: Priority | null
  tags: string[]
  remindEveryMin: number | null
  /** `~30m` → 30, `~2h` → 120 */
  estimateMin: number | null
  /** `^low` / `^med` / `^high` */
  energy: Energy | null
  /** `*daily` … `*yearly`; `*every N <unit>` with N > 1 → `'custom'` + `recurrenceRule` */
  recurrence: Recurrence | null
  recurrenceRule: RecurrenceRule | null
}

const TODAY = ['bugün', 'bugun', 'today', 'сегодня']
const TOMORROW = ['yarın', 'yarin', 'tomorrow', 'завтра']
const WEEKDAYS: Record<string, number> = {
  pazar: 0, pazartesi: 1, salı: 2, sali: 2, çarşamba: 3, carsamba: 3, perşembe: 4, persembe: 4, cuma: 5, cumartesi: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  воскресенье: 0, понедельник: 1, вторник: 2, среда: 3, четверг: 4, пятница: 5, суббота: 6,
  среду: 3, пятницу: 5, субботу: 6, // accusative ("в среду", "в следующую пятницу")
  вс: 0, пн: 1, вт: 2, ср: 3, чт: 4, пт: 5, сб: 6,
}
const PRIORITY_WORDS: Record<string, Priority> = {
  '1': 'high', '2': 'medium', '3': 'low',
  yüksek: 'high', yuksek: 'high', orta: 'medium', düşük: 'low', dusuk: 'low',
  high: 'high', medium: 'medium', med: 'medium', low: 'low',
  высокий: 'high', средний: 'medium', низкий: 'low',
}
const ENERGY_WORDS: Record<string, Energy> = {
  low: 'low', med: 'medium', medium: 'medium', high: 'high',
  düşük: 'low', dusuk: 'low', orta: 'medium', yüksek: 'high', yuksek: 'high',
  низкая: 'low', средняя: 'medium', высокая: 'high',
}
/** `@30dk` / `~2h`: number + optional unit; hours in every language, otherwise minutes. */
const DURATION_RE = /^(\d+)(dk|m|min|мин|sa|h|s|ч)?$/
const HOUR_UNITS = ['sa', 'h', 's', 'ч']

/** Units of relative offsets ("in 2 hours", "3 gün sonra", "через неделю") in minutes. */
const OFFSET_UNITS: Record<string, number> = {
  m: 1, min: 1, mins: 1, minute: 1, minutes: 1, dk: 1, dakika: 1, мин: 1, минут: 1, минуту: 1, минуты: 1,
  h: 60, hr: 60, hrs: 60, hour: 60, hours: 60, sa: 60, saat: 60, ч: 60, час: 60, часа: 60, часов: 60,
  d: 1440, day: 1440, days: 1440, gün: 1440, gun: 1440, д: 1440, день: 1440, дня: 1440, дней: 1440,
  w: 10080, wk: 10080, wks: 10080, week: 10080, weeks: 10080, hafta: 10080, н: 10080, нед: 10080, неделя: 10080, неделю: 10080, недели: 10080, недель: 10080,
}
/** Whole-word amounts without a number: "через час", "через полчаса", "через неделю". */
const OFFSET_WORDS: Record<string, number> = { полчаса: 30, час: 60, день: 1440, неделю: 10080 }
/** Number words accepted in front of an offset unit: "in an hour", "bir hafta sonra". */
const NUM_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, bir: 1, один: 1, одну: 1 }

/** "next week" phrases → Monday of next week. */
const NEXT_WEEK: string[][] = [['next', 'week'], ['haftaya'], ['gelecek', 'hafta'], ['önümüzdeki', 'hafta'], ['onumuzdeki', 'hafta'], ['на', 'следующей', 'неделе'], ['следующей', 'неделе']]
/** "next <weekday>" prefixes → that weekday of next week. */
const NEXT_PREFIX = new Set(['next', 'gelecek', 'önümüzdeki', 'onumuzdeki', 'следующий', 'следующую', 'следующее'])

/** English month names may also precede the day ("oct 15"). */
const MONTHS_EN: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
}
/**
 * TR / RU names only follow the day ("15 ekim", "15 октября"): several Turkish abbreviations are everyday words
 * ("ara" = call, "kas" = muscle), so "anneyi ara 2 …" must not become 2 December.
 */
const MONTHS: Record<string, number> = {
  ...MONTHS_EN,
  oca: 0, ocak: 0, şub: 1, şubat: 1, sub: 1, subat: 1, mart: 2, nis: 3, nisan: 3, mayıs: 4, mayis: 4, haz: 5, haziran: 5,
  tem: 6, temmuz: 6, ağu: 7, ağustos: 7, agu: 7, agustos: 7, eyl: 8, eylül: 8, eylul: 8, eki: 9, ekim: 9, kas: 10, kasım: 10, kasim: 10, ara: 11, aralık: 11, aralik: 11,
  янв: 0, январь: 0, января: 0, фев: 1, февраль: 1, февраля: 1, март: 2, марта: 2, апр: 3, апрель: 3, апреля: 3, мая: 4, май: 4,
  июн: 5, июнь: 5, июня: 5, июл: 6, июль: 6, июля: 6, авг: 7, август: 7, августа: 7, сен: 8, сент: 8, сентябрь: 8, сентября: 8,
  окт: 9, октябрь: 9, октября: 9, ноя: 10, нояб: 10, ноябрь: 10, ноября: 10, дек: 11, декабрь: 11, декабря: 11,
}

/** Named times (single words); "gece yarısı" is matched as a phrase. */
const TIME_WORDS: Record<string, { h: number; m: number }> = {
  noon: { h: 12, m: 0 }, midnight: { h: 0, m: 0 },
  öğlen: { h: 12, m: 0 }, oglen: { h: 12, m: 0 },
  полдень: { h: 12, m: 0 }, полночь: { h: 0, m: 0 },
}

/** `*daily` … single-word recurrence tokens (after the `*`). */
const RECUR_WORDS: Record<string, Recurrence> = {
  daily: 'daily', everyday: 'daily', weekdays: 'weekdays', weekly: 'weekly', monthly: 'monthly', yearly: 'yearly', annually: 'yearly',
  günlük: 'daily', gunluk: 'daily', hergün: 'daily', hergun: 'daily',
  haftaiçi: 'weekdays', 'hafta-içi': 'weekdays', haftaici: 'weekdays', 'hafta-ici': 'weekdays',
  haftalık: 'weekly', haftalik: 'weekly', aylık: 'monthly', aylik: 'monthly', yıllık: 'yearly', yillik: 'yearly',
  ежедневно: 'daily', будни: 'weekdays', еженедельно: 'weekly', ежемесячно: 'monthly', ежегодно: 'yearly',
}
/** `*every 3d` keywords with their own unit tables (TR `h` = hafta/week, so the tables are per keyword). */
const EVERY_KEYWORDS: { words: string[]; units: Record<string, RecurrenceUnit> }[] = [
  { words: ['every'], units: { d: 'day', day: 'day', days: 'day', w: 'week', week: 'week', weeks: 'week', m: 'month', month: 'month', months: 'month', y: 'year', year: 'year', years: 'year' } },
  { words: ['her'], units: { g: 'day', gün: 'day', gun: 'day', h: 'week', hafta: 'week', a: 'month', ay: 'month', y: 'year', yıl: 'year', yil: 'year' } },
  {
    words: ['каждые', 'каждый', 'каждую', 'каждое'],
    units: { д: 'day', день: 'day', дня: 'day', дней: 'day', н: 'week', нед: 'week', неделя: 'week', недели: 'week', недель: 'week', неделю: 'week', м: 'month', мес: 'month', месяц: 'month', месяца: 'month', месяцев: 'month', г: 'year', год: 'year', года: 'year', лет: 'year' },
  },
]
const UNIT_RECURRENCE: Record<RecurrenceUnit, Recurrence> = { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' }

function parseDuration(s: string): number | null {
  const m = DURATION_RE.exec(s)
  if (!m) return null
  const n = Number(m[1])
  return HOUR_UNITS.includes(m[2] ?? 'dk') ? n * 60 : n
}

/** Lower-case for keyword matching; Turkish `İ` lower-cases to `i̇` (i + U+0307) in JS, which would miss `ekim`. */
const lower = (s: string) => s.toLowerCase().replace(/i̇/g, 'i')
const startOf = (ts: number): Date => new Date(startOfDay(ts))
const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate()

/** Words consumed by the first phrase of `phrases` that starts at `i`, or 0. */
function matchPhrase(lw: string[], i: number, phrases: string[][]): number {
  for (const p of phrases) if (p.every((w, k) => lw[i + k] === w)) return p.length
  return 0
}

/** "30m" / "2 hours" / "an hour" / "yarım saat" / "неделю" at `j` → minutes + words consumed. */
function amountAt(lw: string[], j: number): { minutes: number; consumed: number } | null {
  const w = lw[j] ?? ''
  if (!w) return null
  if ((w === 'yarım' || w === 'yarim') && OFFSET_UNITS[lw[j + 1] ?? ''] === 60) return { minutes: 30, consumed: 2 }
  if (Object.hasOwn(OFFSET_WORDS, w)) return { minutes: OFFSET_WORDS[w], consumed: 1 }
  let n: number
  let unit: string | undefined
  let consumed = 1
  const m = /^(\d+)(\D.*)?$/.exec(w)
  if (m) {
    n = Number(m[1])
    unit = m[2]
  } else if (Object.hasOwn(NUM_WORDS, w)) n = NUM_WORDS[w]
  else return null
  if (unit === undefined) {
    unit = lw[j + 1]
    consumed++
  }
  if (n <= 0 || !unit || !Object.hasOwn(OFFSET_UNITS, unit)) return null
  return { minutes: n * OFFSET_UNITS[unit], consumed }
}

/** EN "in <amount>", RU "через <amount>", TR "<amount> sonra". */
function matchOffset(lw: string[], i: number): { minutes: number; consumed: number } | null {
  const w = lw[i]
  if (w === 'in' || w === 'через') {
    const a = amountAt(lw, i + 1)
    return a ? { minutes: a.minutes, consumed: a.consumed + 1 } : null
  }
  const a = amountAt(lw, i)
  if (a && lw[i + a.consumed] === 'sonra') return { minutes: a.minutes, consumed: a.consumed + 1 }
  return null
}

/** "15 oct" / "oct 15" / "15 october 2027" (day 1–31, optional ordinal suffix / trailing comma). */
function matchMonthDate(lw: string[], i: number, now: number): { day: Date; consumed: number } | null {
  const dayNum = (s: string | undefined): number | null => {
    const m = /^(\d{1,2})(?:st|nd|rd|th)?[.,]?$/.exec(s ?? '')
    const n = m ? Number(m[1]) : 0
    return n >= 1 && n <= 31 ? n : null
  }
  const a = lw[i]
  const b = lw[i + 1] ?? ''
  let dn: number | null
  let month: number
  if ((dn = dayNum(a)) !== null && Object.hasOwn(MONTHS, b.replace(/[.,]$/, ''))) month = MONTHS[b.replace(/[.,]$/, '')]
  else if (Object.hasOwn(MONTHS_EN, a) && (dn = dayNum(b)) !== null) month = MONTHS_EN[a]
  else return null
  let consumed = 2
  let year: number | null = null
  if (/^\d{4}$/.test(lw[i + 2] ?? '')) {
    year = Number(lw[i + 2])
    consumed = 3
  }
  const d = startOf(now)
  let y = year ?? d.getFullYear()
  if (dn > daysInMonth(y, month)) return null
  d.setFullYear(y, month, dn)
  if (year === null && d.getTime() < startOf(now).getTime()) {
    y++
    if (dn > daysInMonth(y, month)) return null
    d.setFullYear(y, month, dn)
  }
  return { day: d, consumed }
}

/** `*daily` / `*every 3d` / `*every3d` / `*her 2h` / `*каждые 3 дня` starting at `i` (the word includes the `*`). */
function matchRecurrence(lw: string[], i: number): { recurrence: Recurrence; rule: RecurrenceRule | null; consumed: number } | null {
  const w = lw[i].slice(1)
  if (Object.hasOwn(RECUR_WORDS, w)) return { recurrence: RECUR_WORDS[w], rule: null, consumed: 1 }
  const every = (amount: string, unitWord: string | undefined, units: Record<string, RecurrenceUnit>): { n: number; unit: RecurrenceUnit; extra: number } | null => {
    const m = /^(\d+)(\D*)$/.exec(amount)
    if (!m || Number(m[1]) < 1) return null
    const n = Number(m[1])
    if (m[2]) return Object.hasOwn(units, m[2]) ? { n, unit: units[m[2]], extra: 0 } : null
    return unitWord && Object.hasOwn(units, unitWord) ? { n, unit: units[unitWord], extra: 1 } : null
  }
  const build = (r: { n: number; unit: RecurrenceUnit }, consumed: number) =>
    r.n === 1 ? { recurrence: UNIT_RECURRENCE[r.unit], rule: null, consumed } : { recurrence: 'custom' as const, rule: { every: r.n, unit: r.unit }, consumed }
  for (const { words, units } of EVERY_KEYWORDS) {
    for (const kw of words) {
      if (w === kw) {
        const r = every(lw[i + 1] ?? '', lw[i + 2], units)
        if (r) return build(r, 2 + r.extra)
      } else if (w.startsWith(kw) && /^\d/.test(w.slice(kw.length))) {
        const r = every(w.slice(kw.length), lw[i + 1], units)
        if (r) return build(r, 1 + r.extra)
      }
    }
  }
  return null
}

/** Monday 00:00 of the week after the one containing `now` (weeks start on Monday). */
function nextWeekMonday(now: number): Date {
  const d = startOf(now)
  d.setDate(d.getDate() + ((1 - d.getDay() + 7) % 7 || 7))
  return d
}

export function parseQuickAdd(input: string, _lang: Lang, now = Date.now()): ParsedQuickAdd {
  const out: ParsedQuickAdd = { title: '', dueAt: null, priority: null, tags: [], remindEveryMin: null, estimateMin: null, energy: null, recurrence: null, recurrenceRule: null }
  let day: Date | null = null
  let time: { h: number; m: number } | null = null
  let offsetMin: number | null = null
  const kept: string[] = []
  const words = input.trim().split(/\s+/).filter(Boolean)
  const lw = words.map(lower)

  for (let i = 0; i < words.length; ) {
    const raw = words[i]
    const w = lw[i]
    let m: RegExpMatchArray | null
    let n: number | null

    // ---- single-word prefixed tokens
    if (w.length > 1 && w.startsWith('#')) {
      out.tags.push(w.slice(1).replace(/[.,;]+$/, ''))
      i++
      continue
    }
    if (w.length > 1 && w.startsWith('!') && Object.hasOwn(PRIORITY_WORDS, w.slice(1))) {
      out.priority = PRIORITY_WORDS[w.slice(1)]
      i++
      continue
    }
    if (w.length > 1 && w.startsWith('^') && Object.hasOwn(ENERGY_WORDS, w.slice(1))) {
      out.energy = ENERGY_WORDS[w.slice(1)]
      i++
      continue
    }
    if (w.startsWith('@') && (n = parseDuration(w.slice(1))) !== null) {
      out.remindEveryMin = n
      i++
      continue
    }
    if (w.startsWith('~') && (n = parseDuration(w.slice(1))) !== null && n > 0) {
      out.estimateMin = n
      i++
      continue
    }
    if (w.length > 1 && w.startsWith('*')) {
      const r = matchRecurrence(lw, i)
      if (r) {
        out.recurrence = r.recurrence
        out.recurrenceRule = r.rule
        i += r.consumed
        continue
      }
    }

    // ---- relative offsets: "in 2 hours", "3 gün sonra", "через неделю"
    const off = matchOffset(lw, i)
    if (off) {
      offsetMin = off.minutes
      i += off.consumed
      continue
    }

    // ---- next week / next <weekday>
    const nw = matchPhrase(lw, i, NEXT_WEEK)
    if (nw) {
      day = nextWeekMonday(now)
      i += nw
      continue
    }
    {
      const j = (w === 'в' || w === 'во') && NEXT_PREFIX.has(lw[i + 1] ?? '') ? i + 1 : i
      if (NEXT_PREFIX.has(lw[j]) && Object.hasOwn(WEEKDAYS, lw[j + 1] ?? '')) {
        const d = nextWeekMonday(now)
        d.setDate(d.getDate() + ((WEEKDAYS[lw[j + 1]] + 6) % 7))
        day = d
        i = j + 2
        continue
      }
    }

    // ---- day keywords
    if (TODAY.includes(w)) {
      day = startOf(now)
      i++
      continue
    }
    if (TOMORROW.includes(w)) {
      day = startOf(now + DAY)
      i++
      continue
    }
    {
      // "friday" / "cuma" / "пятница"; RU also "в пятницу"
      const j = (w === 'в' || w === 'во') && Object.hasOwn(WEEKDAYS, lw[i + 1] ?? '') ? i + 1 : i
      if (Object.hasOwn(WEEKDAYS, lw[j])) {
        const d = startOf(now)
        const diff = (WEEKDAYS[lw[j]] - d.getDay() + 7) % 7 || 7
        d.setDate(d.getDate() + diff)
        day = d
        i = j + 1
        continue
      }
    }

    // ---- dates: "15 oct", "oct 15 2027", "15 ekim", "15 октября"; dd.mm[.yyyy]
    const md = matchMonthDate(lw, i, now)
    if (md) {
      day = md.day
      i += md.consumed
      continue
    }
    if ((m = w.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/)) && Number(m[1]) <= 31 && Number(m[2]) <= 12 && Number(m[2]) >= 1) {
      const d = startOf(now)
      const year = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : d.getFullYear()
      d.setFullYear(year, Number(m[2]) - 1, Number(m[1]))
      if (!m[3] && d.getTime() < startOf(now).getTime()) d.setFullYear(year + 1)
      day = d
      i++
      continue
    }

    // ---- times: 12-hour ("5pm", "5:30pm", "5 pm"), named ("noon", "gece yarısı"), 24-hour ("18:00", "18.30")
    {
      const ampm = (h: number, mm: number, p: string): { h: number; m: number } | null => {
        if (h < 1 || h > 12 || mm > 59) return null
        return { h: p === 'am' ? h % 12 : (h % 12) + 12, m: mm }
      }
      let t12: { h: number; m: number } | null = null
      if ((m = w.match(/^(\d{1,2})(?:[:.](\d{2}))?(am|pm)$/)) && (t12 = ampm(Number(m[1]), Number(m[2] ?? 0), m[3]))) {
        time = t12
        i++
        continue
      }
      if ((m = w.match(/^(\d{1,2})(?:[:.](\d{2}))?$/)) && (lw[i + 1] === 'am' || lw[i + 1] === 'pm') && (t12 = ampm(Number(m[1]), Number(m[2] ?? 0), lw[i + 1]))) {
        time = t12
        i += 2
        continue
      }
    }
    if (Object.hasOwn(TIME_WORDS, w)) {
      time = TIME_WORDS[w]
      i++
      continue
    }
    if (w === 'gece' && (lw[i + 1] === 'yarısı' || lw[i + 1] === 'yarisi')) {
      time = { h: 0, m: 0 }
      i += 2
      continue
    }
    if ((m = w.match(/^(\d{1,2})[:.](\d{2})$/)) && Number(m[1]) < 24 && Number(m[2]) < 60) {
      time = { h: Number(m[1]), m: Number(m[2]) }
      i++
      continue
    }

    kept.push(raw)
    i++
  }

  if (offsetMin !== null) {
    // "in 2 hours": exactly now + offset (seconds dropped); an explicit time moves the clock on that day
    const d = new Date(now + offsetMin * 60_000)
    d.setSeconds(0, 0)
    if (time) d.setHours(time.h, time.m, 0, 0)
    out.dueAt = d.getTime()
  } else if (day || time) {
    const d = day ?? startOf(now)
    if (time) {
      d.setHours(time.h, time.m, 0, 0)
      if (!day && d.getTime() <= now) d.setDate(d.getDate() + 1) // "18:00" ve saat geçmişse yarın
      out.dueAt = d.getTime()
    } else {
      out.dueAt = endOfDay(d.getTime())
    }
  }
  if (out.recurrence && out.dueAt === null) out.dueAt = endOfDay(now) // a series needs an anchor

  out.title = kept.join(' ').trim()
  return out
}

/**
 * Brain dump: one task per line. Empty lines are dropped and leading list bullets
 * (`- `, `* `, `• `, `1. `, `1) `) stripped; each line then goes through `parseQuickAdd`.
 */
export function splitBrainDump(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter((line) => line.length > 0)
}

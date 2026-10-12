/**
 * Doğal dilli hızlı ekleme.
 *   "yarın 18:00 fatura öde #ev !1 @30dk"
 *   → başlık "fatura öde", son tarih yarın 18:00, etiket ev, öncelik yüksek, 30 dk'da bir hatırlat
 *
 * Desteklenen parçalar (TR/EN/RU):
 *   #etiket           etiket
 *   !1 !2 !3          öncelik (yüksek / orta / düşük) — !yüksek !high !высокий gibi kelimeler de olur
 *   @30dk @45m @2sa   hatırlatma aralığı; @0 kapatır
 *   bugün yarın       gün
 *   pazartesi … pazar hafta günü (sıradaki)
 *   15.10 / 15/10     gün.ay (gerekirse ay.gün değil, her zaman gün.ay)
 *   18:00 / 18.30     saat
 * Saat verilmeyen günler 23:59'a kurulur; gün verilmeyen saat bugüne (geçmişse yarına) kurulur.
 */
import type { Lang } from './i18n'
import type { Priority } from './types'

export interface ParsedQuickAdd {
  title: string
  dueAt: number | null
  priority: Priority | null
  tags: string[]
  remindEveryMin: number | null
}

const TODAY = ['bugün', 'bugun', 'today', 'сегодня']
const TOMORROW = ['yarın', 'yarin', 'tomorrow', 'завтра']
const WEEKDAYS: Record<string, number> = {
  pazar: 0, pazartesi: 1, salı: 2, sali: 2, çarşamba: 3, carsamba: 3, perşembe: 4, persembe: 4, cuma: 5, cumartesi: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  воскресенье: 0, понедельник: 1, вторник: 2, среда: 3, четверг: 4, пятница: 5, суббота: 6,
  вс: 0, пн: 1, вт: 2, ср: 3, чт: 4, пт: 5, сб: 6,
}
const PRIORITY_WORDS: Record<string, Priority> = {
  '1': 'high', '2': 'medium', '3': 'low',
  yüksek: 'high', yuksek: 'high', orta: 'medium', düşük: 'low', dusuk: 'low',
  high: 'high', medium: 'medium', med: 'medium', low: 'low',
  высокий: 'high', средний: 'medium', низкий: 'low',
}

export function parseQuickAdd(input: string, _lang: Lang, now = Date.now()): ParsedQuickAdd {
  const out: ParsedQuickAdd = { title: '', dueAt: null, priority: null, tags: [], remindEveryMin: null }
  let day: Date | null = null
  let time: { h: number; m: number } | null = null
  const kept: string[] = []

  for (const raw of input.trim().split(/\s+/)) {
    const w = raw.toLowerCase()
    let m: RegExpMatchArray | null

    if (w.length > 1 && w.startsWith('#')) {
      out.tags.push(w.slice(1).replace(/[.,;]+$/, ''))
      continue
    }
    if (w.length > 1 && w.startsWith('!') && PRIORITY_WORDS[w.slice(1)]) {
      out.priority = PRIORITY_WORDS[w.slice(1)]
      continue
    }
    if ((m = w.match(/^@(\d+)(dk|m|min|мин|sa|h|s|ч)?$/))) {
      const n = Number(m[1])
      const unit = m[2] ?? 'dk'
      out.remindEveryMin = ['sa', 'h', 's', 'ч'].includes(unit) ? n * 60 : n
      continue
    }
    if (TODAY.includes(w)) {
      day = startOf(now)
      continue
    }
    if (TOMORROW.includes(w)) {
      day = startOf(now + 86_400_000)
      continue
    }
    if (w in WEEKDAYS) {
      const d = startOf(now)
      const diff = (WEEKDAYS[w] - d.getDay() + 7) % 7 || 7
      d.setDate(d.getDate() + diff)
      day = d
      continue
    }
    if ((m = w.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/)) && Number(m[1]) <= 31 && Number(m[2]) <= 12 && Number(m[2]) >= 1) {
      const d = startOf(now)
      const year = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : d.getFullYear()
      d.setFullYear(year, Number(m[2]) - 1, Number(m[1]))
      if (!m[3] && d.getTime() < startOf(now).getTime()) d.setFullYear(year + 1)
      day = d
      continue
    }
    if ((m = w.match(/^(\d{1,2})[:.](\d{2})$/)) && Number(m[1]) < 24 && Number(m[2]) < 60) {
      time = { h: Number(m[1]), m: Number(m[2]) }
      continue
    }
    kept.push(raw)
  }

  if (day || time) {
    const d = day ?? startOf(now)
    if (time) d.setHours(time.h, time.m, 0, 0)
    else d.setHours(23, 59, 0, 0)
    if (!day && time && d.getTime() <= now) d.setDate(d.getDate() + 1) // "18:00" ve saat geçmişse yarın
    out.dueAt = d.getTime()
  }

  out.title = kept.join(' ').trim()
  return out
}

function startOf(ts: number): Date {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d
}

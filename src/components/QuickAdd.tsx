import { forwardRef, useState } from 'react'
import { parseQuickAdd, splitBrainDump } from '../lib/parse'
import { formatDue, formatMinutes, recurrenceText } from '../lib/dates'
import { ENERGY_ICON } from '../lib/types'
import { useLang, useT } from '../lib/useT'

interface Props {
  onAdd(text: string): void
  /** Several non-empty lines (paste, Shift+Enter): one task per line. Without it every line goes through `onAdd`. */
  onAddMany?(lines: string[]): void
  /** Focus the input on mount (quick-add popup). */
  autoFocus?: boolean
  /** Escape with the input focused: by default the input just blurs. */
  onEscape?(): void
  /** The box grows with the lines typed, up to this many rows (default 6; the popup window uses 1). */
  maxRows?: number
}

/**
 * Doğal dilli hızlı ekleme: yazarken anlaşılan tarih/öncelik/etiketler önizlenir.
 * Brain dump (#11): a textarea — Enter adds, Shift+Enter starts a new line, a multi-line paste
 * keeps its lines; several lines become several tasks ("N tasks" in the preview).
 */
const QuickAdd = forwardRef<HTMLTextAreaElement, Props>(function QuickAdd({ onAdd, onAddMany, autoFocus, onEscape, maxRows = 6 }, ref) {
  const t = useT()
  const lang = useLang()
  const [v, setV] = useState('')
  const [focus, setFocus] = useState(false)
  const lines = splitBrainDump(v)
  const many = lines.length > 1
  const parsed = parseQuickAdd(many ? '' : v, lang)
  const hasMeta = parsed.dueAt !== null || parsed.priority !== null || parsed.tags.length > 0 || parsed.remindEveryMin !== null || parsed.estimateMin !== null || parsed.energy !== null || parsed.recurrence !== null
  const canSubmit = many || parsed.title.length > 0
  const rows = Math.min(maxRows, Math.max(1, v.split('\n').length))

  const submit = () => {
    if (!canSubmit) return
    if (many) {
      if (onAddMany) onAddMany(lines)
      else lines.forEach(onAdd)
    } else {
      onAdd(v.trim())
    }
    setV('')
  }

  return (
    <div className="quick-add-wrap">
      <div className="quick-add">
        <textarea
          ref={ref}
          rows={rows}
          value={v}
          autoFocus={autoFocus}
          onChange={(e) => setV(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
            if (e.key === 'Escape') {
              if (onEscape) onEscape()
              else (e.target as HTMLTextAreaElement).blur()
            }
          }}
          placeholder={t('quick_add_ph')}
        />
        <button className="mini" onClick={submit} disabled={!canSubmit}>
          {t('add')}
        </button>
      </div>
      {many ? (
        <div className="qa-preview">
          <span className="chip brain">🧠 {t('qa_many', { n: lines.length })}</span>
        </div>
      ) : hasMeta ? (
        <div className="qa-preview">
          {parsed.dueAt !== null && <span className="chip remind">📅 {formatDue(parsed.dueAt, lang)}</span>}
          {parsed.recurrence && <span className="chip rec">↻ {recurrenceText(parsed.recurrence, parsed.recurrenceRule, lang)}</span>}
          {parsed.priority && <span className={`chip prio ${parsed.priority}`}>{t(`p_${parsed.priority}` as const)}</span>}
          {parsed.remindEveryMin !== null && <span className="chip">🔔 {parsed.remindEveryMin === 0 ? t('no_reminder') : t('every_min', { n: parsed.remindEveryMin })}</span>}
          {parsed.estimateMin !== null && <span className="chip est">⏱ ~{formatMinutes(parsed.estimateMin, lang)}</span>}
          {parsed.energy && (
            <span className={`chip energy ${parsed.energy}`}>
              {ENERGY_ICON[parsed.energy]} {t(`energy_${parsed.energy}` as const).replace(/^\S+\s/, '')}
            </span>
          )}
          {parsed.tags.map((x) => (
            <span key={x} className="tag">
              #{x}
            </span>
          ))}
        </div>
      ) : (
        focus && !v && <p className="hint qa-hint">{t('qa_hint')}</p>
      )}
    </div>
  )
})

export default QuickAdd

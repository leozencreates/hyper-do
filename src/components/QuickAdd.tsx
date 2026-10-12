import { forwardRef, useState } from 'react'
import { parseQuickAdd } from '../lib/parse'
import { formatDue } from '../lib/dates'
import { useLang, useT } from '../lib/useT'

interface Props {
  onAdd(text: string): void
}

/** Doğal dilli hızlı ekleme: yazarken anlaşılan tarih/öncelik/etiketler önizlenir. */
const QuickAdd = forwardRef<HTMLInputElement, Props>(function QuickAdd({ onAdd }, ref) {
  const t = useT()
  const lang = useLang()
  const [v, setV] = useState('')
  const [focus, setFocus] = useState(false)
  const parsed = parseQuickAdd(v, lang)
  const hasMeta = parsed.dueAt !== null || parsed.priority !== null || parsed.tags.length > 0 || parsed.remindEveryMin !== null

  const submit = () => {
    if (!parsed.title) return
    onAdd(v.trim())
    setV('')
  }

  return (
    <div className="quick-add-wrap">
      <div className="quick-add">
        <input
          ref={ref}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
          }}
          placeholder={t('quick_add_ph')}
        />
        <button className="mini" onClick={submit} disabled={!parsed.title}>
          {t('add')}
        </button>
      </div>
      {hasMeta ? (
        <div className="qa-preview">
          {parsed.dueAt !== null && <span className="chip remind">📅 {formatDue(parsed.dueAt, lang)}</span>}
          {parsed.priority && <span className={`chip prio ${parsed.priority}`}>{t(`p_${parsed.priority}` as const)}</span>}
          {parsed.remindEveryMin !== null && <span className="chip">🔔 {parsed.remindEveryMin === 0 ? t('no_reminder') : t('every_min', { n: parsed.remindEveryMin })}</span>}
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

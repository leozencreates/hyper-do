import { useMemo } from 'react'
import type { AppData } from '../lib/types'
import { LOCALE } from '../lib/i18n'
import { useLang, useT } from '../lib/useT'
import { addDays, dayKey, dayKeyToDate, formatMinutes, startOfDay } from '../lib/dates'
import { bestStreak, doneInLastDays, focusMinutes, heatmap, streak, topTags } from '../lib/stats'
import Modal from './Modal'

const WEEKS = 12

interface Props {
  data: AppData
  now: number
  onClose(): void
}

/** Stats (#9): streaks, completions, a 12-week heatmap, Hyper Focus minutes and the top tags of the week. */
export default function StatsModal({ data, now, onClose }: Props) {
  const t = useT()
  const lang = useLang()
  const todayKey = dayKey(now)
  const dayStart = startOfDay(now)
  const weekStart = addDays(dayStart, -6)
  const current = streak(data.dailyDone, todayKey)
  const best = bestStreak(data.dailyDone)
  const doneToday = data.dailyDone[todayKey] ?? 0
  const doneWeek = doneInLastDays(data.dailyDone, 7, now)
  const focusToday = focusMinutes(data.focusLog, dayStart, Number.MAX_SAFE_INTEGER)
  const focusWeek = focusMinutes(data.focusLog, weekStart, Number.MAX_SAFE_INTEGER)
  const tags = useMemo(() => topTags(data.tasks, weekStart), [data.tasks, weekStart])
  const cells = useMemo(() => heatmap(data.dailyDone, WEEKS, now), [data.dailyDone, now])
  const dayLabel = (key: string) => dayKeyToDate(key).toLocaleDateString(LOCALE[lang], { day: 'numeric', month: 'short' })

  return (
    <Modal title={t('stats_title')} onClose={onClose}>
      <div className="stat-grid">
        <Stat label={t('stats_streak')} value={`🔥 ${t('stats_days', { n: current })}`} />
        <Stat label={t('stats_best')} value={`🏆 ${t('stats_days', { n: best })}`} />
        <Stat label={t('stats_done_today')} value={`✓ ${doneToday}`} />
        <Stat label={t('stats_done_week')} value={`✓ ${doneWeek}`} />
        <Stat label={t('stats_focus_today')} value={`⚡ ${formatMinutes(focusToday, lang)}`} />
        <Stat label={t('stats_focus_week')} value={`⚡ ${formatMinutes(focusWeek, lang)}`} />
      </div>

      <div className="field">
        <span>{t('stats_heatmap')}</span>
        <div className="heatmap" style={{ gridTemplateColumns: `repeat(${WEEKS}, 1fr)` }}>
          {cells.map((c) => (
            <span key={c.key} className={`heat l${c.level}${c.future ? ' future' : ''}${c.key === todayKey ? ' today' : ''}`} title={t('heat_cell', { d: dayLabel(c.key), n: c.count })} />
          ))}
        </div>
      </div>

      <div className="field">
        <span>{t('stats_top_tags')}</span>
        {tags.length === 0 ? (
          <p className="hint">{t('stats_no_tags')}</p>
        ) : (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {tags.map((x) => (
              <span key={x.tag} className="tag">
                #{x.tag} · {x.count}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="modal-actions">
        <button className="primary" onClick={onClose}>
          {t('ok')}
        </button>
      </div>
    </Modal>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}

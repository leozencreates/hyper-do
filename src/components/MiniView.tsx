import { useEffect } from 'react'
import { useAppData, type AppStore } from '../lib/store'
import { platform } from '../lib/platform'
import type { AppData } from '../lib/types'
import { formatDue } from '../lib/dates'
import { LangContext, useLang, useT } from '../lib/useT'
import { useTheme } from '../lib/hooks'
import { useTaskActions } from '../lib/useTaskActions'
import { fmtCountdown, useHyperFocus } from './HyperFocus'

/**
 * The mini window (`?view=mini`, Electron only, #7): a 340×150 always-on-top card with the focus
 * task, its next open subtask, the Hyper Focus ring and Done / Snooze / Focus / Expand buttons.
 * It reads the store exactly like the main window (and receives every `tidi:data-changed`
 * broadcast); the Hyper Focus hook runs in read-only mode, the main window drives the timer.
 */
export default function MiniView() {
  const store = useAppData()
  if (!store.data) return <div className="loading">…</div>
  return (
    <LangContext.Provider value={store.data.settings.language}>
      <Mini {...store} data={store.data} />
    </LangContext.Provider>
  )
}

function Mini({ data, setTasks, setSettings, setHyperFocus, updateData, appendFocusEntry }: AppStore & { data: AppData }) {
  const t = useT()
  const lang = useLang()
  const { tasks, settings } = data
  useTheme(settings.theme)
  useEffect(() => {
    document.documentElement.dataset.view = 'mini'
  }, [])

  const hf = useHyperFocus(data.hyperFocus, setHyperFocus, settings.pomodoro, settings.language, { driver: false, onPhaseEnd: appendFocusEntry })
  const actions = useTaskActions({ tasks, settings, setTasks, setSettings, updateData })
  const desktop = platform.desktop
  const session = hf.session

  const focusTask = tasks.find((x) => x.focused && x.completedAt === null) ?? null
  const task = focusTask ?? (session?.taskId ? (tasks.find((x) => x.id === session.taskId && x.completedAt === null) ?? null) : null)
  const next = task?.subtasks.find((s) => !s.done) ?? null
  const paused = session !== null && session.pausedRemaining !== null
  const progress = session && hf.totalMs > 0 ? 1 - hf.remainingMs / hf.totalMs : 0

  const toggleFocus = () => {
    if (!session) hf.start(task?.id ?? null)
    else if (session.pausedRemaining !== null) hf.resume()
    else hf.pause()
  }

  const cls = ['mini-view', session?.phase, paused && 'paused'].filter(Boolean).join(' ')

  return (
    <div className={cls}>
      <button className="mini-close no-drag" title={t('mini_hide')} onClick={() => void desktop?.hideMini()}>
        ✕
      </button>
      {session && (
        <div className="hf-ring mini-ring" style={{ ['--p' as string]: `${Math.round(progress * 100)}%` }}>
          <span className="hf-time">{fmtCountdown(hf.remainingMs)}</span>
        </div>
      )}
      <div className="mini-body">
        {task ? (
          <>
            <div className="mini-title" title={task.title}>
              {task.title}
            </div>
            <div className="mini-next">{next ? `↳ ${next.title}` : task.dueAt !== null ? formatDue(task.dueAt, lang) : session ? (session.phase === 'work' ? t('hf_work') : t('hf_break')) : ''}</div>
          </>
        ) : (
          <>
            <div className="mini-title muted">{t('mini_no_task')}</div>
            <div className="mini-next">{t('mini_no_task_hint')}</div>
          </>
        )}
        <div className="mini-actions no-drag">
          <button className="mini ok" disabled={!task} onClick={() => task && actions.complete(task.id)}>
            {t('mini_done')}
          </button>
          <button className="mini" disabled={!task} onClick={() => task && actions.snooze(task.id, 30)}>
            {t('mini_snooze')}
          </button>
          <button className="mini hf" onClick={toggleFocus}>
            {!session ? t('mini_focus_start') : paused ? t('mini_focus_resume') : t('mini_focus_pause')}
          </button>
          <button className="mini" title={t('mini_expand')} onClick={() => void desktop?.showMain()}>
            ↗
          </button>
        </div>
      </div>
    </div>
  )
}

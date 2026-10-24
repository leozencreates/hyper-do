import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppData, type AppStore } from './lib/store'
import { matchesQuery, newTask, pickEasyTask, sortTasks, uid } from './lib/tasks'
import { ENERGIES, ENERGY_ICON, SORT_MODES, type AppData, type ConnectionStatus, type Energy, type SortMode, type Task, type UpdateStatus } from './lib/types'
import { dayKey, isOverdue, isToday, isThisWeek } from './lib/dates'
import { escalationLevel } from './lib/reminder'
import { spentMinByTask, streak } from './lib/stats'
import { shareToTaskFields } from './lib/share'
import { referencedMediaIds } from './lib/attachments'
import { platform } from './lib/platform'
import { LangContext, useT } from './lib/useT'
import { LANGS, LOCALE, translate, type Lang } from './lib/i18n'
import { useNow, useTheme } from './lib/hooks'
import { tgHaptic, tgLang } from './lib/tg-bridge'
import { useTaskActions } from './lib/useTaskActions'
import { useSounds } from './lib/useSounds'
import { inFocusWork } from './lib/sound'
import { useCalendar } from './lib/useCalendar'
import TwoMinuteStart from './components/TwoMinuteStart'
import { WeeklyReview, Templates } from './components/PlanningTools'
import { usePlanningCopy } from './lib/planning-i18n'
import { isBlocked } from './lib/planning'
import TaskItem from './components/TaskItem'
import TaskEditor from './components/TaskEditor'
import FocusBanner from './components/FocusBanner'
import SettingsPanel from './components/SettingsPanel'
import QuickAdd from './components/QuickAdd'
import QuickCapture from './components/QuickCapture'
import MiniView from './components/MiniView'
import StatsModal from './components/StatsModal'
import BrainDump from './components/BrainDump'
import WhatNow from './components/WhatNow'
import Stuck from './components/Stuck'
import RoutineRunner from './components/RoutineRunner'
import { isRunnable, routineFromTemplate, type RoutineTemplate } from './lib/routine'
import Board from './components/Board'
import CalendarStrip from './components/CalendarStrip'
import ConnectionPanel from './components/ConnectionPanel'
import { HyperFocusBar, useHyperFocus } from './components/HyperFocus'
import { useCelebration } from './components/Celebration'

type View = 'today' | 'week' | 'all' | 'board' | 'done' | 'inbox' | 'archive'
const VIEW_KEYS: View[] = ['today', 'week', 'all', 'board', 'done', 'inbox', 'archive']

/**
 * `?view=` is read once at startup. Besides the list views it selects the renderer *window kind*:
 * `quick` = the global quick-add popup, `mini` = the always-on-top mini window (both Electron).
 */
const VIEW_PARAM = new URLSearchParams(location.search).get('view')
/** `?task=<id>` (Telegram "📱 Open in app" buttons): that task's editor opens once the data is loaded. */
const TASK_PARAM = new URLSearchParams(location.search).get('task')
/** Telegram Mini App: phone layout with the bottom tab bar, data on the PC, no desktop-only controls. */
const IS_TG = platform.kind === 'telegram'
/** Tabs of the Mini App's bottom bar (the ＋ tab is added separately). */
const TG_TABS: View[] = ['today', 'week', 'board', 'done']

/** Time-dependent UI (overdue, "today") refreshes this often without user interaction. */
const CLOCK_MS = 30_000
/** The "Try this" suggestion disappears by itself after this long. */
const EASY_TOAST_MS = 12_000

export default function App() {
  if (VIEW_PARAM === 'quick') return <QuickCapture />
  if (VIEW_PARAM === 'mini') return <MiniView />
  return <MainApp />
}

/** Live state of the platform's data connection (Telegram Mini App); null where the data is local. */
function useConnection(): ConnectionStatus | null {
  const api = platform.connection
  const [s, setS] = useState<ConnectionStatus | null>(() => api?.status() ?? null)
  useEffect(() => api?.onStatus(setS), [api])
  return s
}

function MainApp() {
  const store = useAppData()
  const conn = useConnection()
  const retry = () => platform.connection?.retry()
  if (!store.data) {
    if (conn && (conn.state === 'unreachable' || conn.state === 'forbidden')) return <ConnectionPanel status={conn} lang={tgLang()} onRetry={retry} />
    return <div className="loading">{IS_TG ? translate(tgLang(), 'tgapp_connecting') : '…'}</div>
  }
  return (
    <LangContext.Provider value={store.data.settings.language}>
      <Main {...store} data={store.data} />
      {conn?.state === 'forbidden' && <ConnectionPanel status={conn} lang={store.data.settings.language} onRetry={retry} />}
    </LangContext.Provider>
  )
}

type MainProps = AppStore & { data: AppData }

function Main({ data, setTasks, setSettings, setHyperFocus, updateData, appendFocusEntry, replaceData }: MainProps) {
  const t = useT()
  const c = usePlanningCopy()
  const { tasks, settings } = data
  // The Mini App only shows a Hyper Focus session running on the PC; the desktop drives the phases.
  // Sound effects: the master switch lives in settings, a Hyper Focus work round silences everything by itself.
  const play = useSounds(settings, data.hyperFocus)
  const chimeDone = useCallback(() => play('complete'), [play])
  const hf = useHyperFocus(data.hyperFocus, setHyperFocus, settings.pomodoro, settings.language, { driver: !IS_TG, onPhaseEnd: appendFocusEntry, play })
  const cal = useCalendar()
  const now = useNow(CLOCK_MS)
  const celebration = useCelebration(settings.celebrate, chimeDone)
  const conn = useConnection()
  const actions = useTaskActions({
    tasks,
    settings,
    setTasks,
    setSettings,
    updateData,
    onSound: play,
    onCompleted: () => {
      celebration.celebrate()
      if (IS_TG) tgHaptic('success')
    },
  })
  const [view, setView] = useState<View>(() => {
    const v = VIEW_PARAM as View | null
    return v && VIEW_KEYS.includes(v) ? v : 'today'
  })
  const [tag, setTag] = useState<string | null>(null)
  const [energy, setEnergy] = useState<Energy | null>(null)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Task | null>(null)
  const [startId, setStartId] = useState<string | null>(null)
  const [showReview, setShowReview] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [showBrain, setShowBrain] = useState(false)
  /** 🧭 What now? dialog. */
  const [showNext, setShowNext] = useState(false)
  /** 😴 "Stuck?" dialog for this task id. */
  const [stuckId, setStuckId] = useState<string | null>(null)
  /** 🔁 Routine runner for this task id; `rtMenu` = the "+ Routine" template menu in the sidebar. */
  const [runId, setRunId] = useState<string | null>(null)
  const [rtMenu, setRtMenu] = useState(false)
  const [highlight, setHighlight] = useState<string | null>(null)
  /** "Give me an easy one": the suggested task id, or null for "nothing open". */
  const [easy, setEasy] = useState<{ id: string | null } | null>(null)
  const [perm, setPerm] = useState(platform.permission())
  /** Android 12+: exact-alarm permission (null = unknown / not applicable). Re-checked whenever the app comes back to the front. */
  const [exactOk, setExactOk] = useState<boolean | null>(null)
  useEffect(() => {
    if (!platform.exactAlarms || perm !== 'granted') return
    const check = () => void platform.exactAlarms!().then(setExactOk)
    check()
    const onVis = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [perm])
  const [confirmClear, setConfirmClear] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  /** A downloaded update waiting for a restart (#18); `null` once dismissed with "Later" or when nothing is ready. */
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const quickRef = useRef<HTMLTextAreaElement>(null)
  const desktop = platform.desktop
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const scrollTo = (id: string) => setTimeout(() => document.getElementById('task-' + id)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50)

  // Bildirime tıklanınca ilgili görevi vurgula
  useEffect(() => {
    const off1 = platform.onFocusTask((id) => {
      setView('all')
      setHighlight(id)
      scrollTo(id)
    })
    const off2 = platform.onReminded((id) => {
      setHighlight(id)
      setTimeout(() => setHighlight((h) => (h === id ? null : h)), 6000)
    })
    return () => {
      off1()
      off2()
    }
  }, [])

  // "Share → Hyper Do" (#15, Android): the shared text opens the editor prefilled (title = subject or first line, notes = everything)
  useEffect(
    () =>
      platform.onShare?.((p) => {
        const { title, notes } = shareToTaskFields(p)
        if (!title) return
        setShowSettings(false)
        setShowStats(false)
        setShowBrain(false)
        setEditing(newTask({ title, notes, status: 'todo' }, settingsRef.current))
      }),
    [],
  )

  // "📱 Open in app" from a Telegram reminder / card: ?task=<id> opens that task's editor after the first load
  useEffect(() => {
    if (!TASK_PARAM) return
    const x = tasks.find((y) => y.id === TASK_PARAM)
    if (!x) return
    setEditing(x)
    setHighlight(x.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Attachments: files no task points at any more (removed in the editor, task deleted) are dropped once per start
  useEffect(() => {
    void platform.media?.gc(referencedMediaIds(tasks)).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-update (#18): a downloaded update shows a toast until "Restart now" / "Later"
  useEffect(() => {
    if (!desktop) return
    let alive = true
    const show = (s: UpdateStatus) => {
      if (s.status === 'downloaded') setUpdate((cur) => (cur && cur.version === s.version ? cur : s))
    }
    void desktop.updateStatus().then((s) => alive && show(s))
    const off = desktop.onUpdateStatus(show)
    return () => {
      alive = false
      off()
    }
  }, [desktop])

  // Tema: koyu / açık / sistem (inside Telegram the client's colour scheme wins)
  useTheme(IS_TG ? 'telegram' : settings.theme)

  const allTags = useMemo(() => {
    const s = new Set<string>()
    tasks.forEach((x) => x.tags.forEach((y) => s.add(y)))
    return [...s].sort()
  }, [tasks])
  const hasEnergy = useMemo(() => tasks.some((x) => x.completedAt === null && x.energy !== null), [tasks])

  const filtered = useMemo(() => {
    let list = tasks.filter((x) => view === 'archive' ? x.archived : !x.archived)
    if (view === 'done') list = list.filter((x) => x.completedAt !== null)
    else if (view !== 'board' && view !== 'archive') {
      list = list.filter((x) => !x.archived && x.completedAt === null)
      if (view === 'today') list = list.filter((x) => x.dueAt !== null && (isToday(x.dueAt, now) || isOverdue(x.dueAt, now)))
      if (view === 'inbox') list = list.filter((x) => x.dueAt === null)
      if (view === 'week') list = list.filter((x) => x.dueAt !== null && (isThisWeek(x.dueAt, now) || isOverdue(x.dueAt, now)))
    }
    if (tag) list = list.filter((x) => x.tags.includes(tag))
    if (energy) list = list.filter((x) => x.energy === energy)
    if (query.trim()) list = list.filter((x) => matchesQuery(x, query))
    return list
  }, [tasks, view, tag, energy, query, now])

  const visible = useMemo(() => {
    if (view === 'done') return [...filtered].sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    return sortTasks(filtered, settings.sort, now)
  }, [filtered, view, settings.sort, now])

  const spentByTask = useMemo(() => spentMinByTask(data.focusLog), [data.focusLog])
  const currentStreak = useMemo(() => streak(data.dailyDone, dayKey(now)), [data.dailyDone, now])

  const focusTask = tasks.find((x) => x.focused && !x.archived && x.completedAt === null) ?? null
  const hfTask = hf.session?.taskId ? (tasks.find((x) => x.id === hf.session!.taskId) ?? null) : focusTask
  const openCount = tasks.filter((x) => !x.archived && x.completedAt === null).length
  const overdueCount = tasks.filter((x) => !x.archived && x.completedAt === null && isOverdue(x.dueAt, now)).length
  const doneToday = tasks.filter((x) => x.completedAt !== null && isToday(x.completedAt, now)).length
  const doneCount = tasks.filter((x) => !x.archived && x.completedAt !== null).length
  const runTask = runId ? (tasks.find((x) => x.id === runId && !x.archived && x.completedAt === null) ?? null) : null
  const routines = tasks.filter((x) => x.routine && !x.archived && x.completedAt === null)
  /** "+ Routine": the editor opens prefilled (template steps in the current language); nothing is saved before Save. */
  const newRoutine = (kind: RoutineTemplate | null) => {
    setRtMenu(false)
    setEditing(newTask(kind ? { ...routineFromTemplate(kind, settings.language, Date.now()), status: 'todo' } : { routine: true, recurrence: 'daily', status: 'todo' }, settings))
  }
  const stuckTask = stuckId ? (tasks.find((x) => x.id === stuckId && !x.archived && x.completedAt === null) ?? null) : null
  const easyTask = easy?.id ? (tasks.find((x) => x.id === easy.id && !x.archived && x.completedAt === null) ?? null) : null

  /** 🎲 Easy one (#10): suggest a low-effort open task, bring it into view and highlight it. */
  const pickEasy = (exclude: string | null = null) => {
    const open = tasks.filter((x) => !x.archived && x.completedAt === null)
    const pick = pickEasyTask(open.filter((x) => x.id !== exclude)) ?? pickEasyTask(open)
    setEasy({ id: pick?.id ?? null })
    if (!pick) return
    if (!visible.some((x) => x.id === pick.id)) {
      setView('all')
      setTag(null)
      setEnergy(null)
      setQuery('')
    }
    setHighlight(pick.id)
    scrollTo(pick.id)
  }
  const pickEasyRef = useRef(pickEasy)
  pickEasyRef.current = pickEasy

  // The suggestion toast goes away by itself
  useEffect(() => {
    if (!easy) return
    const h = window.setTimeout(() => setEasy(null), EASY_TOAST_MS)
    return () => window.clearTimeout(h)
  }, [easy])

  // Klavye kısayolları (bir alan yazılırken ya da pencere açıkken devre dışı)
  const modalOpen = startId !== null || showReview || showTemplates || !!editing || showSettings || showStats || showBrain || showNext || stuckId !== null || runId !== null
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (modalOpen || e.ctrlKey || e.metaKey || e.altKey) return
      const el = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      const k = e.key.toLowerCase()
      if (k === 'n') {
        e.preventDefault()
        setEditing(newTask({ status: 'todo' }, settings))
      } else if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (k === 'e') {
        e.preventDefault()
        pickEasyRef.current()
      } else if (k === 'w') {
        e.preventDefault()
        setShowNext(true)
      } else if (k === 'b') {
        e.preventDefault()
        setShowBrain(true)
      } else if (k === 'm' && desktop) {
        e.preventDefault()
        void desktop.toggleMini()
      } else if (e.key >= '1' && e.key <= '7') {
        setView(VIEW_KEYS[Number(e.key) - 1])
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [modalOpen, settings, desktop])

  const clearDone = () => {
    actions.clearDone()
    setConfirmClear(false)
  }

  /** Liste görünümünde sürükleyerek sıralama. */
  const startTask = tasks.find((x) => x.id === startId && x.completedAt === null && !x.archived)

  const dropOn = (beforeId: string | null) => {
    if (!dragId) return
    actions.reorder(dragId, beforeId)
    setDragId(null)
  }

  const viewLabel = (v: View) => v === 'inbox' ? c.inbox : v === 'archive' ? c.archive : t(`view_${v}` as const)

  /** ＋ tab of the Mini App: the quick-add box, focused (it only exists in the list views). */
  const addFromTab = () => {
    if (view === 'board' || view === 'done') setView('today')
    setTimeout(() => {
      quickRef.current?.focus()
      quickRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 50)
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-dot" /> Hyper Do
        </div>
        <nav>
          {VIEW_KEYS.map((v, i) => (
            <button key={v} className={view === v ? `nav v-${v} active` : `nav v-${v}`} onClick={() => setView(v)} title={`${i + 1}`}>
              <span className="nav-dot" />
              <span className="nav-label">{viewLabel(v)}</span>
              {v === 'today' && overdueCount > 0 && <span className="badge danger">{overdueCount}</span>}
              {v === 'all' && openCount > 0 && <span className="badge">{openCount}</span>}
            </button>
          ))}
        </nav>
        <div className="tags-block rt-block">
          <div className="section-title rt-head">
            <span>{t('rt_section')}</span>
            <button className="ghost small" title={t('rt_new_title')} aria-expanded={rtMenu} onClick={() => setRtMenu((v) => !v)}>
              {t('rt_new')}
            </button>
          </div>
          {rtMenu && (
            <div className="rt-menu">
              <button className="tagbtn" onClick={() => newRoutine('morning')}>
                🌅 {t('rt_morning')}
              </button>
              <button className="tagbtn" onClick={() => newRoutine('evening')}>
                🌙 {t('rt_evening')}
              </button>
              <button className="tagbtn" onClick={() => newRoutine(null)}>
                ＋ {t('rt_empty')}
              </button>
            </div>
          )}
          {routines.map((r) => (
            <div key={r.id} className="rt-item">
              <button className="tagbtn rt-name" title={r.title} onClick={() => setEditing(r)}>
                🔁 {r.title}
              </button>
              {isRunnable(r) && (
                <button className="mini rt-run" title={t('rt_run_title')} onClick={() => setRunId(r.id)}>
                  ▶
                </button>
              )}
            </div>
          ))}
        </div>
        {allTags.length > 0 && (
          <div className="tags-block">
            <div className="section-title">{t('tags')}</div>
            <button className={tag === null ? 'tagbtn active' : 'tagbtn'} onClick={() => setTag(null)}>
              {t('all_tags')}
            </button>
            {allTags.map((x) => (
              <button key={x} className={tag === x ? 'tagbtn active' : 'tagbtn'} onClick={() => setTag(tag === x ? null : x)}>
                #{x}
              </button>
            ))}
          </div>
        )}
        {hasEnergy && (
          <div className="tags-block energy-block">
            <div className="section-title">{t('energy')}</div>
            <div className="energy-chips">
              {ENERGIES.map((e) => (
                <button key={e} className={energy === e ? `energybtn ${e} active` : `energybtn ${e}`} title={t(`energy_${e}` as const)} onClick={() => setEnergy(energy === e ? null : e)}>
                  {ENERGY_ICON[e]}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="sidebar-footer">
          <div className="stats">{t('stats_line', { done: doneToday, open: openCount })}</div>
          <div className="footer-row">
            <button className="ghost streak" title={t('streak_title', { n: currentStreak })} onClick={() => setShowStats(true)}>
              🔥 {currentStreak}
            </button>
            <button className="ghost" onClick={() => setShowStats(true)}>
              {t('stats_btn')}
            </button>
          </div>
          <div className="footer-row">
            <button className="ghost" onClick={() => setShowSettings(true)}>
              ⚙ {t('settings')}
            </button>
            <select
              className="lang-switch"
              value={settings.language}
              title={t('s_language')}
              aria-label={t('s_language')}
              onChange={(e) => setSettings((s) => ({ ...s, language: e.target.value as Lang }))}
            >
              {LANGS.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </aside>

      <main className={view === 'board' ? 'content board-view' : 'content'}>
        {platform.kind !== 'electron' && perm !== 'granted' && (
          <div className="perm-banner">
            <span>{perm === 'denied' ? t('web_perm_denied') : t('web_perm')}</span>
            {perm === 'default' && (
              <button className="primary" onClick={() => void platform.requestPermission().then(setPerm)}>
                {t('web_perm_btn')}
              </button>
            )}
          </div>
        )}
        {platform.kind !== 'electron' && perm === 'granted' && exactOk === false && platform.requestExactAlarms && (
          <div className="perm-banner">
            <span>{t('exact_perm')}</span>
            <button className="primary" onClick={() => void platform.requestExactAlarms!().then(setExactOk)}>
              {t('exact_perm_btn')}
            </button>
          </div>
        )}

        <HyperFocusBar hf={hf} task={hfTask} suppressOthers={settings.focusSuppressOthers} />

        {focusTask && view !== 'board' && (
          <FocusBanner
            task={focusTask}
            onComplete={() => actions.complete(focusTask.id)}
            onUnfocus={() => actions.setFocus(focusTask.id, false)}
            onToggleSub={(sid) => actions.toggleSub(focusTask, sid)}
            onHyperFocus={hf.session || IS_TG ? undefined : () => hf.start(focusTask.id)}
          />
        )}
        <div className="planning-toolbar"><button className="ghost small" onClick={() => setShowReview(true)}>{c.review}</button><button className="ghost small" onClick={() => setShowTemplates(true)}>{c.templates}</button>{<button className="ghost small" onClick={() => setView('inbox')}>{c.inbox} ({tasks.filter((x) => !x.archived && x.completedAt === null && x.dueAt === null).length})</button>}</div>

        <header className="content-head">
          <h1>{viewLabel(view)}</h1>
          <div className="head-tools">
            {conn && (conn.state === 'unreachable' || !conn.saved) && (
              <button className="mini chip-unsaved" title={conn.error ?? ''} onClick={() => platform.connection?.retry()}>
                {conn.saved ? t('tgapp_offline') : t('tgapp_unsaved')} · {t('tgapp_retry')}
              </button>
            )}
            {!hf.session && !IS_TG && (
              <button className="hf-start" title="Pomodoro" onClick={() => hf.start(focusTask?.id ?? null)}>
                {t('hf_start')}
              </button>
            )}
            <button className="ghost small" title={t('wn_btn_title')} onClick={() => setShowNext(true)}>
              {t('wn_btn')}
            </button>
            <button className="ghost small" title={t('easy_title')} onClick={() => pickEasy()}>
              {t('easy_btn')}
            </button>
            <button className="ghost small" title="B" onClick={() => setShowBrain(true)}>
              {t('brain_btn')}
            </button>
            {desktop && (
              <button className="ghost small" title={`${t('mini_window')} (M)`} onClick={() => void desktop.toggleMini()}>
                ▣
              </button>
            )}
            {/* Sound effects switch; during a Hyper Focus work round it shows the automatic silence. Not saved from the Mini App (settings stay on the PC). */}
            <button
              className={`ghost small snd-btn${settings.sounds && !inFocusWork(data.hyperFocus) ? '' : ' off'}`}
              title={!settings.sounds ? t('snd_unmute') : inFocusWork(data.hyperFocus) ? t('snd_focus') : t('snd_mute')}
              aria-pressed={settings.sounds}
              disabled={IS_TG}
              onClick={() => setSettings((s) => ({ ...s, sounds: !s.sounds }))}
            >
              {settings.sounds && !inFocusWork(data.hyperFocus) ? '🔊' : '🔇'}
            </button>
            {settings.mutedUntil !== null && settings.mutedUntil > now && (
              // Settings are never saved from the Mini App, so there the chip only informs (unmute on the PC or with /mute off)
              <button className="ghost small" title={t('tg_unmuted')} disabled={IS_TG} onClick={() => setSettings((s) => ({ ...s, mutedUntil: null }))}>
                {t('mute_chip', { t: new Date(settings.mutedUntil).toLocaleTimeString(LOCALE[settings.language], { hour: '2-digit', minute: '2-digit' }) })}
              </button>
            )}
            <input
              ref={searchRef}
              className="search"
              value={query}
              placeholder={t('search_ph')}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setQuery('')
                  ;(e.target as HTMLInputElement).blur()
                }
              }}
            />
            {view !== 'board' && view !== 'done' && !IS_TG && (
              <select className="sort" value={settings.sort} title={t('sort_label')} onChange={(e) => setSettings((s) => ({ ...s, sort: e.target.value as SortMode }))}>
                {SORT_MODES.map((s) => (
                  <option key={s} value={s}>
                    {t(`sort_${s}` as const)}
                  </option>
                ))}
              </select>
            )}
            {view === 'done' && doneCount > 0 && (
              confirmClear ? (
                <span className="row">
                  <span className="hint">{t('clear_done_q', { n: doneCount })}</span>
                  <button className="mini danger" onClick={clearDone}>
                    {t('delete')}
                  </button>
                  <button className="mini" onClick={() => setConfirmClear(false)}>
                    {t('cancel')}
                  </button>
                </span>
              ) : (
                <button className="ghost small" onClick={() => setConfirmClear(true)}>
                  🧹 {t('clear_done')}
                </button>
              )
            )}
            {!IS_TG && (
              <button className="primary" onClick={() => setEditing(newTask({ status: 'todo' }, settings))}>
                {t('new_task')}
              </button>
            )}
          </div>
        </header>

        {view !== 'done' && view !== 'board' && (
          <QuickAdd
            ref={quickRef}
            onAdd={(text) => actions.quickAdd(text, {})}
            onAddMany={(lines) => actions.quickAddMany(lines, {})}
          />
        )}

        {cal.available && settings.calendar.showEvents && (view === 'today' || view === 'week') && !query.trim() && (
          <CalendarStrip
            events={cal.events}
            view={view}
            onMakeTask={(e) => setEditing(newTask({ title: e.title, dueAt: e.allDay ? e.start + 9 * 3_600_000 : e.start, notes: e.location ?? '', status: 'todo' }, settings))}
          />
        )}

        {view === 'board' ? (
          <Board
            tasks={filtered}
            highlight={highlight}
            onOpen={setEditing}
            onComplete={actions.complete}
            onReopen={actions.reopen}
            onMove={actions.move}
            onAdd={(status, text) => actions.quickAdd(text, { status })}
            draggable={!IS_TG}
          />
        ) : visible.length === 0 ? (
          <div className="empty">{view === 'done' ? t('empty_done') : t('empty_open')}</div>
        ) : (
          <ul className="task-list" onDragOver={(e) => dragId && e.preventDefault()} onDrop={() => dropOn(null)}>
            {visible.map((x) => (
              <TaskItem
                key={x.id}
                task={x}
                highlighted={highlight === x.id}
                spentMin={spentByTask[x.id] ?? 0}
                escalation={escalationLevel(x, settings)}
                onComplete={() => actions.complete(x.id)}
                onReopen={() => actions.reopen(x.id)}
                onEdit={() => setEditing(x)}
                onFocus={() => actions.setFocus(x.id, !x.focused)}
                onSnooze={(m) => actions.snooze(x.id, m)}
                onToggleSub={(sid) => actions.toggleSub(x, sid)}
                onDelete={() => actions.remove(x.id)}
                onDuplicate={() => actions.duplicate(x.id)}
                onPostpone={() => actions.postpone(x)}
                onStuck={() => setStuckId(x.id)}
                onRun={() => setRunId(x.id)}
                onStart={isBlocked(x, tasks) ? undefined : () => setStartId(x.id)}
                drag={
                  view !== 'done' && !IS_TG
                    ? {
                        dragging: dragId === x.id,
                        onDragStart: () => setDragId(x.id),
                        onDragEnd: () => setDragId(null),
                        onDrop: () => dropOn(x.id),
                      }
                    : undefined
                }
              />
            ))}
          </ul>
        )}
      </main>

      {IS_TG && (
        <nav className="tg-tabs" aria-label="views">
          {TG_TABS.map((v) => (
            <button key={v} type="button" className={view === v ? `tg-tab v-${v} active` : `tg-tab v-${v}`} onClick={() => setView(v)}>
              <span className="tg-tab-dot" />
              <span className="tg-tab-label">{viewLabel(v)}</span>
              {v === 'today' && overdueCount > 0 && <span className="badge danger">{overdueCount}</span>}
            </button>
          ))}
          <button type="button" className="tg-tab add" aria-label={t('add')} title={t('add')} onClick={addFromTab}>
            ＋
          </button>
        </nav>
      )}

      {actions.undo && (
        <div className="toast">
          <span>{t('deleted_toast')}: {actions.undo.task.title}</span>
          <button className="mini" onClick={actions.undoDelete}>
            ↶ {t('undo')}
          </button>
        </div>
      )}

      {easy && !actions.undo && (
        <div className="toast easy-toast">
          {easyTask ? (
            <>
              <span>🎲 {t('easy_try', { title: easyTask.title })}</span>
              <button
                className="mini"
                onClick={() => {
                  actions.setFocus(easyTask.id, true)
                  setEasy(null)
                }}
              >
                {t('easy_focus')}
              </button>
              <button className="mini" onClick={() => pickEasy(easyTask.id)}>
                {t('easy_another')}
              </button>
            </>
          ) : (
            <span>{t('easy_none')}</span>
          )}
          <button className="icon" title={t('dismiss')} onClick={() => setEasy(null)}>
            ✕
          </button>
        </div>
      )}

      {update && desktop && !actions.undo && !easy && (
        <div className="toast update-toast">
          <span>⬆ {t('update_toast', { v: update.version ?? '?' })}</span>
          <button className="mini" onClick={() => void desktop.installUpdate()}>
            {t('update_install')}
          </button>
          <button className="mini" onClick={() => setUpdate(null)}>
            {t('update_later')}
          </button>
        </div>
      )}

      {celebration.element}

      {editing && (
        <TaskEditor
          task={editing}
          allTags={allTags}
          tasks={tasks}
          focusLog={data.focusLog}
          onTemplate={(name, task) => setSettings((s) => ({ ...s, taskTemplates: [...s.taskTemplates, { id: uid(), name, task: { ...task, attachments: [], history: [] } }] }))}
          onCancel={() => setEditing(null)}
          onSave={(nt) => {
            actions.save(nt)
            setEditing(null)
          }}
        />
      )}

      {runTask && (
        <RoutineRunner
          task={runTask}
          onSteps={(subtasks) => actions.update(runTask.id, { subtasks, nagCount: 0 })}
          onComplete={() => {
            actions.complete(runTask.id)
            setRunId(null)
          }}
          onClose={() => setRunId(null)}
        />
      )}
      {stuckTask && (
        <Stuck
          task={stuckTask}
          now={now}
          onSplit={() => {
            actions.unstick(stuckTask.id)
            setStuckId(null)
            setEditing({ ...stuckTask, snoozeCount: 0 })
          }}
          onDate={(dueAt) => {
            actions.unstick(stuckTask.id, { dueAt, snoozedUntil: null })
            setStuckId(null)
          }}
          onNow={() => {
            actions.unstick(stuckTask.id, { snoozedUntil: null })
            actions.setFocus(stuckTask.id, true)
            if (!hf.session && !IS_TG) hf.start(stuckTask.id)
            setStuckId(null)
          }}
          onDrop={() => {
            actions.remove(stuckTask.id)
            setStuckId(null)
          }}
          onKeep={() => {
            actions.unstick(stuckTask.id)
            setStuckId(null)
          }}
          onClose={() => setStuckId(null)}
        />
      )}
      {showNext && (
        <WhatNow
          tasks={tasks}
          now={now}
          onFocus={(x) => {
            actions.setFocus(x.id, true)
            setShowNext(false)
            setHighlight(x.id)
            scrollTo(x.id)
          }}
          onHyperFocus={hf.session || IS_TG ? undefined : (x) => {
            actions.setFocus(x.id, true)
            hf.start(x.id)
            setShowNext(false)
          }}
          onOpen={(x) => {
            setShowNext(false)
            setEditing(x)
          }}
          onClose={() => setShowNext(false)}
        />
      )}
      {showBrain && <BrainDump onAdd={(lines) => actions.quickAddMany(lines, {})} onClose={() => setShowBrain(false)} />}

      {startTask && <TwoMinuteStart key={startTask.id} task={startTask} onStep={(firstStep) => { actions.update(startTask.id, { firstStep }); actions.setFocus(startTask.id, true) }} onClose={() => setStartId(null)} onContinue={hf.session || IS_TG ? undefined : () => { hf.start(startTask.id); setStartId(null) }} />}
      {showReview && <WeeklyReview data={data} now={now} onEdit={(task) => { setShowReview(false); setEditing(task) }} onArchive={(task) => actions.update(task.id, { archived: true, focused: false })} onClose={() => setShowReview(false)} />}
      {showTemplates && <Templates settings={settings} onChange={(s) => setSettings(() => s)} onUse={(task) => { setShowTemplates(false); setEditing(task) }} onClose={() => setShowTemplates(false)} />}
      {showStats && <StatsModal data={data} now={now} onClose={() => setShowStats(false)} />}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          data={data}
          cal={cal}
          onChange={(s) => setSettings(() => s)}
          onImport={(d) => {
            replaceData(d)
            setShowSettings(false)
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}

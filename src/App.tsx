import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppData, type AppStore } from './lib/store'
import { newTask } from './lib/tasks'
import { matchesQuery, sortTasks } from './lib/tasks'
import { SORT_MODES, type AppData, type SortMode, type Task } from './lib/types'
import { endOfDay, isOverdue, isToday, isThisWeek } from './lib/dates'
import { platform } from './lib/platform'
import { LangContext, useT } from './lib/useT'
import { LANGS, type Lang } from './lib/i18n'
import { useNow } from './lib/hooks'
import { useTaskActions } from './lib/useTaskActions'
import { useCalendar } from './lib/useCalendar'
import TaskItem from './components/TaskItem'
import TaskEditor from './components/TaskEditor'
import FocusBanner from './components/FocusBanner'
import SettingsPanel from './components/SettingsPanel'
import QuickAdd from './components/QuickAdd'
import Board from './components/Board'
import CalendarStrip from './components/CalendarStrip'
import { HyperFocusBar, useHyperFocus } from './components/HyperFocus'

type View = 'today' | 'week' | 'all' | 'board' | 'done'
const VIEW_KEYS: View[] = ['today', 'week', 'all', 'board', 'done']

/** Time-dependent UI (overdue, "today") refreshes this often without user interaction. */
const CLOCK_MS = 30_000

export default function App() {
  const store = useAppData()
  if (!store.data) return <div className="loading">…</div>
  return (
    <LangContext.Provider value={store.data.settings.language}>
      <Main {...store} data={store.data} />
    </LangContext.Provider>
  )
}

type MainProps = AppStore & { data: AppData }

function Main({ data, setTasks, setSettings, replaceData }: MainProps) {
  const t = useT()
  const { tasks, settings } = data
  const hf = useHyperFocus(settings.pomodoro, settings.language)
  const cal = useCalendar()
  const now = useNow(CLOCK_MS)
  const actions = useTaskActions({ tasks, settings, setTasks, setSettings })
  const [view, setView] = useState<View>(() => {
    const v = new URLSearchParams(location.search).get('view') as View | null
    return v && VIEW_KEYS.includes(v) ? v : 'today'
  })
  const [tag, setTag] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Task | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [perm, setPerm] = useState(platform.permission())
  const [confirmClear, setConfirmClear] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const quickRef = useRef<HTMLInputElement>(null)

  // Bildirime tıklanınca ilgili görevi vurgula
  useEffect(() => {
    const off1 = platform.onFocusTask((id) => {
      setView('all')
      setHighlight(id)
      setTimeout(() => document.getElementById('task-' + id)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50)
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

  // Tema: koyu / açık / sistem
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const apply = () => {
      document.documentElement.dataset.theme = settings.theme === 'system' ? (mq.matches ? 'light' : 'dark') : settings.theme
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings.theme])

  // Klavye kısayolları (bir alan yazılırken ya da pencere açıkken devre dışı)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (editing || showSettings || e.ctrlKey || e.metaKey || e.altKey) return
      const el = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        setEditing(newTask({ status: 'todo' }, settings))
      } else if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key >= '1' && e.key <= '5') {
        setView(VIEW_KEYS[Number(e.key) - 1])
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [editing, showSettings, settings])

  const allTags = useMemo(() => {
    const s = new Set<string>()
    tasks.forEach((x) => x.tags.forEach((y) => s.add(y)))
    return [...s].sort()
  }, [tasks])

  const filtered = useMemo(() => {
    let list = tasks
    if (view === 'done') list = list.filter((x) => x.completedAt !== null)
    else if (view !== 'board') {
      list = list.filter((x) => x.completedAt === null)
      if (view === 'today') list = list.filter((x) => x.dueAt === null || isToday(x.dueAt, now) || isOverdue(x.dueAt, now))
      if (view === 'week') list = list.filter((x) => x.dueAt !== null && (isThisWeek(x.dueAt, now) || isOverdue(x.dueAt, now)))
    }
    if (tag) list = list.filter((x) => x.tags.includes(tag))
    if (query.trim()) list = list.filter((x) => matchesQuery(x, query))
    return list
  }, [tasks, view, tag, query, now])

  const visible = useMemo(() => {
    if (view === 'done') return [...filtered].sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    return sortTasks(filtered, settings.sort, now)
  }, [filtered, view, settings.sort, now])

  const focusTask = tasks.find((x) => x.focused && x.completedAt === null) ?? null
  const hfTask = hf.session?.taskId ? (tasks.find((x) => x.id === hf.session!.taskId) ?? null) : focusTask
  const openCount = tasks.filter((x) => x.completedAt === null).length
  const overdueCount = tasks.filter((x) => x.completedAt === null && isOverdue(x.dueAt, now)).length
  const doneToday = tasks.filter((x) => x.completedAt !== null && isToday(x.completedAt, now)).length
  const doneCount = tasks.length - openCount

  const clearDone = () => {
    actions.clearDone()
    setConfirmClear(false)
  }

  /** Liste görünümünde sürükleyerek sıralama. */
  const dropOn = (beforeId: string | null) => {
    if (!dragId) return
    actions.reorder(dragId, beforeId)
    setDragId(null)
  }

  const viewLabel = (v: View) => t(`view_${v}` as const)

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
        <div className="sidebar-footer">
          <div className="stats">{t('stats_line', { done: doneToday, open: openCount })}</div>
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

        <HyperFocusBar hf={hf} task={hfTask} />

        {focusTask && view !== 'board' && (
          <FocusBanner
            task={focusTask}
            onComplete={() => actions.complete(focusTask.id)}
            onUnfocus={() => actions.setFocus(focusTask.id, false)}
            onToggleSub={(sid) => actions.toggleSub(focusTask, sid)}
            onHyperFocus={hf.session ? undefined : () => hf.start(focusTask.id)}
          />
        )}

        <header className="content-head">
          <h1>{viewLabel(view)}</h1>
          <div className="head-tools">
            {!hf.session && (
              <button className="hf-start" title="Pomodoro" onClick={() => hf.start(focusTask?.id ?? null)}>
                {t('hf_start')}
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
            {view !== 'board' && view !== 'done' && (
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
            <button className="primary" onClick={() => setEditing(newTask({ status: 'todo' }, settings))}>
              {t('new_task')}
            </button>
          </div>
        </header>

        {view !== 'done' && view !== 'board' && (
          <QuickAdd ref={quickRef} onAdd={(text) => actions.quickAdd(text, { defaultDueAt: view === 'today' ? endOfDay(now) : null })} />
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
                onComplete={() => actions.complete(x.id)}
                onReopen={() => actions.reopen(x.id)}
                onEdit={() => setEditing(x)}
                onFocus={() => actions.setFocus(x.id, !x.focused)}
                onSnooze={(m) => actions.snooze(x.id, m)}
                onToggleSub={(sid) => actions.toggleSub(x, sid)}
                onDelete={() => actions.remove(x.id)}
                onDuplicate={() => actions.duplicate(x.id)}
                onPostpone={() => actions.postpone(x)}
                drag={
                  view !== 'done'
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

      {actions.undo && (
        <div className="toast">
          <span>{t('deleted_toast')}: {actions.undo.task.title}</span>
          <button className="mini" onClick={actions.undoDelete}>
            ↶ {t('undo')}
          </button>
        </div>
      )}

      {editing && (
        <TaskEditor
          task={editing}
          allTags={allTags}
          onCancel={() => setEditing(null)}
          onSave={(nt) => {
            actions.save(nt)
            setEditing(null)
          }}
        />
      )}

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

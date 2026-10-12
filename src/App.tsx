import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppData, newTask, completeTask } from './lib/store'
import { duplicateTask, matchesQuery, reorderTasks, sortTasks } from './lib/tasks'
import { parseQuickAdd } from './lib/parse'
import type { SortMode, Status, Task } from './lib/types'
import { isOverdue, isToday, isThisWeek, DAY } from './lib/dates'
import { platform } from './lib/platform'
import { LangContext, useT } from './lib/useT'
import { LANGS, type Lang } from './lib/i18n'
import TaskItem from './components/TaskItem'
import TaskEditor from './components/TaskEditor'
import FocusBanner from './components/FocusBanner'
import SettingsPanel from './components/SettingsPanel'
import QuickAdd from './components/QuickAdd'
import Board from './components/Board'
import { HyperFocusBar, useHyperFocus } from './components/HyperFocus'

type View = 'today' | 'week' | 'all' | 'board' | 'done'
const VIEW_KEYS: View[] = ['today', 'week', 'all', 'board', 'done']
const SORTS: SortMode[] = ['smart', 'due', 'priority', 'created', 'alpha', 'manual']

export default function App() {
  const store = useAppData()
  if (!store.data) return <div className="loading">…</div>
  return (
    <LangContext.Provider value={store.data.settings.language}>
      <Main {...store} data={store.data} />
    </LangContext.Provider>
  )
}

type MainProps = ReturnType<typeof useAppData> & { data: NonNullable<ReturnType<typeof useAppData>['data']> }

function Main({ data, setTasks, setSettings, replaceData }: MainProps) {
  const t = useT()
  const hf = useHyperFocus(data.settings.pomodoro, data.settings.language)
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
  const [undo, setUndo] = useState<{ task: Task; index: number } | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const quickRef = useRef<HTMLInputElement>(null)

  const { tasks, settings } = data

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

  // Geri alma bildirimi 6 sn sonra kaybolur
  useEffect(() => {
    if (!undo) return
    const h = setTimeout(() => setUndo(null), 6000)
    return () => clearTimeout(h)
  }, [undo])

  const allTags = useMemo(() => {
    const s = new Set<string>()
    tasks.forEach((x) => x.tags.forEach((y) => s.add(y)))
    return [...s].sort()
  }, [tasks])

  const now = Date.now()
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
  const openCount = tasks.filter((x) => x.completedAt === null).length
  const overdueCount = tasks.filter((x) => x.completedAt === null && isOverdue(x.dueAt, now)).length
  const doneToday = tasks.filter((x) => x.completedAt !== null && isToday(x.completedAt, now)).length
  const doneCount = tasks.length - openCount

  const update = (id: string, patch: Partial<Task>) => setTasks((ts) => ts.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const remove = (id: string) => {
    const index = tasks.findIndex((x) => x.id === id)
    if (index < 0) return
    setUndo({ task: tasks[index], index })
    setTasks((ts) => ts.filter((x) => x.id !== id))
  }
  const undoDelete = () => {
    if (!undo) return
    const { task, index } = undo
    setTasks((ts) => {
      const out = [...ts]
      out.splice(Math.min(index, out.length), 0, task)
      return out
    })
    setUndo(null)
  }
  const complete = (id: string) => setTasks((ts) => completeTask(ts, id))
  const reopen = (id: string) => update(id, { completedAt: null })
  const setFocus = (id: string, on: boolean) => setTasks((ts) => ts.map((x) => ({ ...x, focused: x.id === id ? on : false })))
  const snooze = (id: string, minutes: number) => update(id, { snoozedUntil: Date.now() + minutes * 60_000 })
  const toggleSub = (task: Task, sid: string) => update(task.id, { subtasks: task.subtasks.map((s) => (s.id === sid ? { ...s, done: !s.done } : s)) })
  const duplicate = (id: string) => setTasks((ts) => duplicateTask(ts, id, t('copy_suffix')))
  const postpone = (task: Task) => {
    if (task.dueAt === null) return
    const base = Math.max(task.dueAt, now)
    update(task.id, { dueAt: base + DAY, snoozedUntil: null })
  }
  const clearDone = () => {
    setTasks((ts) => ts.filter((x) => x.completedAt === null))
    setConfirmClear(false)
  }

  /** Hızlı ekleme: doğal dil ayrıştırılır ("yarın 18:00 fatura #ev !1 @30dk"). */
  const quickAdd = (text: string, status: Status = 'todo') => {
    const p = parseQuickAdd(text, settings.language)
    if (!p.title) return
    const nt = newTask(
      {
        title: p.title,
        dueAt: p.dueAt ?? (view === 'today' ? endOfToday() : null),
        priority: p.priority ?? 'medium',
        tags: p.tags,
        remindEveryMin: p.remindEveryMin ?? settings.defaultRemindEveryMin,
        status,
        order: Math.min(0, ...tasks.map((x) => x.order)) - 1000, // en üste
      },
      settings,
    )
    setTasks((ts) => [nt, ...ts])
  }

  /** Pano: kartı başka sütuna / sıraya taşı. "Bitti" sütununa bırakmak görevi tamamlar. */
  const move = (id: string, to: Status | 'done', beforeId: string | null) => {
    setTasks((ts) => {
      const task = ts.find((x) => x.id === id)
      if (!task) return ts
      if (to === 'done') return task.completedAt !== null ? ts : completeTask(ts, id)
      const reopened = task.completedAt !== null ? ts.map((x) => (x.id === id ? { ...x, completedAt: null } : x)) : ts
      return reorderTasks(reopened, id, beforeId, to)
    })
  }

  /** Liste görünümünde sürükleyerek sıralama; sıralama otomatik "Elle" moduna geçer. */
  const dropOn = (beforeId: string | null) => {
    if (!dragId) return
    setTasks((ts) => reorderTasks(ts, dragId, beforeId))
    if (settings.sort !== 'manual') setSettings((s) => ({ ...s, sort: 'manual' }))
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

        <HyperFocusBar hf={hf} task={hf.session?.taskId ? (data.tasks.find((x) => x.id === hf.session!.taskId) ?? null) : focusTask ?? null} />

        {focusTask && view !== 'board' && (
          <FocusBanner
            task={focusTask}
            onComplete={() => complete(focusTask.id)}
            onUnfocus={() => setFocus(focusTask.id, false)}
            onToggleSub={(sid) => toggleSub(focusTask, sid)}
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
                {SORTS.map((s) => (
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

        {view !== 'done' && view !== 'board' && <QuickAdd ref={quickRef} onAdd={(text) => quickAdd(text)} />}

        {view === 'board' ? (
          <Board
            tasks={filtered}
            highlight={highlight}
            onOpen={setEditing}
            onComplete={complete}
            onReopen={reopen}
            onMove={move}
            onAdd={(status, text) => quickAdd(text, status)}
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
                onComplete={() => complete(x.id)}
                onReopen={() => reopen(x.id)}
                onEdit={() => setEditing(x)}
                onFocus={() => setFocus(x.id, !x.focused)}
                onSnooze={(m) => snooze(x.id, m)}
                onToggleSub={(sid) => toggleSub(x, sid)}
                onDelete={() => remove(x.id)}
                onDuplicate={() => duplicate(x.id)}
                onPostpone={() => postpone(x)}
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

      {undo && (
        <div className="toast">
          <span>{t('deleted_toast')}: {undo.task.title}</span>
          <button className="mini" onClick={undoDelete}>
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
            setTasks((ts) => (ts.some((x) => x.id === nt.id) ? ts.map((x) => (x.id === nt.id ? nt : x)) : [nt, ...ts]))
            setEditing(null)
          }}
        />
      )}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          data={data}
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

function endOfToday() {
  const d = new Date()
  d.setHours(23, 59, 0, 0)
  return d.getTime()
}

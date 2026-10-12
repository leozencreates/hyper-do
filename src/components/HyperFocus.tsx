import { useCallback, useEffect, useRef, useState } from 'react'
import type { Settings, Task } from '../lib/types'
import { translate, type Lang } from '../lib/i18n'
import { useT } from '../lib/useT'

/**
 * Hyper Focus: a Pomodoro-style timer (default 40 min deep work / 5 min break)
 * that repeats until stopped. Phase changes trigger a notification and a soft chime.
 */
export type HfPhase = 'work' | 'break'
export interface HfSession {
  phase: HfPhase
  round: number
  endsAt: number
  /** When paused: remaining ms at the moment of pausing. */
  pausedRemaining: number | null
  taskId: string | null
}

const KEY = 'hyperdo-hyperfocus'

function load(): HfSession | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as HfSession) : null
  } catch {
    return null
  }
}
function persist(s: HfSession | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s))
    else localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

function chime(phase: HfPhase) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const notes = phase === 'break' ? [660, 880] : [880, 660, 990]
    notes.forEach((f, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = f
      g.gain.value = 0.0001
      o.connect(g)
      g.connect(ctx.destination)
      const t0 = ctx.currentTime + i * 0.18
      g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4)
      o.start(t0)
      o.stop(t0 + 0.42)
    })
    setTimeout(() => void ctx.close(), 1500)
  } catch {
    /* audio blocked */
  }
}

function notify(title: string, body: string) {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const n = new Notification(title, { body, tag: 'hyperdo-hf', icon: './icon.svg' })
      n.onclick = () => {
        window.focus()
        n.close()
      }
    }
  } catch {
    /* some platforms only allow notifications via service worker */
  }
}

export function useHyperFocus(pomodoro: Settings['pomodoro'], lang: Lang) {
  const [session, setSession] = useState<HfSession | null>(() => load())
  const [now, setNow] = useState(() => Date.now())
  const ref = useRef(session)
  ref.current = session

  useEffect(() => persist(session), [session])

  useEffect(() => {
    if (!session) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [session])

  const advance = useCallback(
    (s: HfSession, skip = false): HfSession => {
      const nextPhase: HfPhase = s.phase === 'work' ? 'break' : 'work'
      const round = nextPhase === 'work' ? s.round + 1 : s.round
      const mins = nextPhase === 'work' ? pomodoro.workMin : pomodoro.breakMin
      if (!skip) {
        chime(nextPhase)
        if (nextPhase === 'break') notify(translate(lang, 'hf_notif_break'), translate(lang, 'hf_notif_break_d', { n: pomodoro.breakMin }))
        else notify(translate(lang, 'hf_notif_work'), translate(lang, 'hf_notif_work_d', { r: round, n: pomodoro.workMin }))
      }
      return { ...s, phase: nextPhase, round, endsAt: Date.now() + mins * 60_000, pausedRemaining: null }
    },
    [pomodoro, lang],
  )

  // Phase transition
  useEffect(() => {
    const s = ref.current
    if (!s || s.pausedRemaining !== null) return
    if (now >= s.endsAt) setSession(advance(s))
  }, [now, advance])

  const start = useCallback(
    (taskId: string | null) => {
      setNow(Date.now())
      setSession({ phase: 'work', round: 1, endsAt: Date.now() + pomodoro.workMin * 60_000, pausedRemaining: null, taskId })
    },
    [pomodoro.workMin],
  )
  const pause = useCallback(() => setSession((s) => (s && s.pausedRemaining === null ? { ...s, pausedRemaining: Math.max(0, s.endsAt - Date.now()) } : s)), [])
  const resume = useCallback(() => setSession((s) => (s && s.pausedRemaining !== null ? { ...s, endsAt: Date.now() + s.pausedRemaining, pausedRemaining: null } : s)), [])
  const skip = useCallback(() => setSession((s) => (s ? advance(s, true) : s)), [advance])
  const stop = useCallback(() => setSession(null), [])

  const totalMs = session ? (session.phase === 'work' ? pomodoro.workMin : pomodoro.breakMin) * 60_000 : 0
  const remainingMs = session ? (session.pausedRemaining !== null ? session.pausedRemaining : Math.max(0, session.endsAt - now)) : 0

  return { session, remainingMs, totalMs, start, pause, resume, skip, stop }
}

function fmt(ms: number) {
  const s = Math.ceil(ms / 1000)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

interface BarProps {
  hf: ReturnType<typeof useHyperFocus>
  task: Task | null
}

/** The active-session bar: progress ring, countdown, phase, round and controls. */
export function HyperFocusBar({ hf, task }: BarProps) {
  const t = useT()
  const { session, remainingMs, totalMs } = hf
  const label = session ? (session.phase === 'work' ? t('hf_work') : t('hf_break')) : ''

  useEffect(() => {
    if (!session) return
    document.title = `${fmt(remainingMs)} · ${label} – Hyper Do`
    return () => {
      document.title = 'Hyper Do'
    }
  }, [session, remainingMs, label])

  if (!session) return null
  const progress = totalMs > 0 ? 1 - remainingMs / totalMs : 0
  const paused = session.pausedRemaining !== null

  return (
    <section className={`hf-bar ${session.phase}${paused ? ' paused' : ''}`}>
      <div className="hf-ring" style={{ ['--p' as string]: `${Math.round(progress * 100)}%` }}>
        <span className="hf-time">{fmt(remainingMs)}</span>
      </div>
      <div className="hf-body">
        <div className="hf-head">
          <span className="hf-phase">{session.phase === 'work' ? '⚡' : '🧘'} {label}</span>
          <span className="chip">{t('hf_round', { n: session.round })}</span>
        </div>
        <div className="hf-task">{task ? task.title : t('hf_no_task')}</div>
        <div className="hf-actions">
          {paused ? (
            <button className="primary" onClick={hf.resume}>
              ▶ {t('hf_resume')}
            </button>
          ) : (
            <button className="mini" onClick={hf.pause}>
              ⏸ {t('hf_pause')}
            </button>
          )}
          <button className="mini" onClick={hf.skip}>
            ⏭ {t('hf_skip')}
          </button>
          <button className="mini danger" onClick={hf.stop}>
            ■ {t('hf_stop')}
          </button>
        </div>
      </div>
    </section>
  )
}

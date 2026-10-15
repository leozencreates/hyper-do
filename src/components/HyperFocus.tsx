import { useCallback, useEffect, useRef, useState } from 'react'
import type { FocusEntry, HfPhase, HfSession, Settings, Task } from '../lib/types'
import { translate, type Lang } from '../lib/i18n'
import { useT } from '../lib/useT'
import { chimePhase } from '../lib/sound'
import { uid } from '../lib/tasks'

/**
 * Hyper Focus: a Pomodoro-style timer (default 40 min deep work / 5 min break)
 * that repeats until stopped. Phase changes trigger a notification and a soft chime.
 * The session itself lives in `AppData.hyperFocus` (store), so the platform's reminder
 * engine can hold back other tasks while a work round runs. Finished phases of at least a
 * minute are handed to `onPhaseEnd` (the focus log, #8).
 */
export type { HfPhase, HfSession }

/** Phases shorter than this are not logged (accidental starts). */
const MIN_LOG_MS = 60_000

function notify(title: string, body: string) {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const n = new Notification(title, { body, tag: 'hyperdo-hf', icon: './icon-192.png' })
      n.onclick = () => {
        window.focus()
        n.close()
      }
    }
  } catch {
    /* some platforms only allow notifications via service worker */
  }
}

type SetSession = (fn: (s: HfSession | null) => HfSession | null) => void

export interface HfOptions {
  /**
   * The main window drives the timer (phase transitions, chime, notification). A second window
   * showing the same session (mini window) passes `driver: false` so phases do not advance twice.
   */
  driver?: boolean
  /** Receives every finished phase (timer, skip, stop) that lasted at least a minute. */
  onPhaseEnd?(entry: FocusEntry): void
  /** `settings.sounds`: false silences the phase chimes (notifications still fire). Default true. */
  sounds?: boolean
}

const phaseMs = (s: HfSession, pomodoro: Settings['pomodoro']) => (s.phase === 'work' ? pomodoro.workMin : pomodoro.breakMin) * 60_000

export function useHyperFocus(session: HfSession | null, setSession: SetSession, pomodoro: Settings['pomodoro'], lang: Lang, { driver = true, onPhaseEnd, sounds = true }: HfOptions = {}) {
  const [now, setNow] = useState(() => Date.now())
  const ref = useRef(session)
  ref.current = session

  useEffect(() => {
    if (!session) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [session])

  /** Logs the phase that is ending right now. Paused sessions end at the moment they were paused. */
  const logPhase = useCallback(
    (s: HfSession, nowMs: number) => {
      if (!onPhaseEnd) return
      const endedAt = s.pausedRemaining !== null ? s.startedAt + Math.max(0, phaseMs(s, pomodoro) - s.pausedRemaining) : Math.min(nowMs, s.endsAt)
      if (endedAt - s.startedAt < MIN_LOG_MS) return
      onPhaseEnd({ id: uid(), taskId: s.taskId, phase: s.phase, startedAt: s.startedAt, endedAt })
    },
    [onPhaseEnd, pomodoro],
  )

  /** Next phase; side effects (log, chime, notification) happen here, so call it outside state updaters. */
  const advance = useCallback(
    (s: HfSession, skip = false): HfSession => {
      const nowMs = Date.now()
      const nextPhase: HfPhase = s.phase === 'work' ? 'break' : 'work'
      const round = nextPhase === 'work' ? s.round + 1 : s.round
      const mins = nextPhase === 'work' ? pomodoro.workMin : pomodoro.breakMin
      logPhase(s, nowMs)
      if (!skip) {
        if (sounds) chimePhase(nextPhase)
        if (nextPhase === 'break') notify(translate(lang, 'hf_notif_break'), translate(lang, 'hf_notif_break_d', { n: pomodoro.breakMin }))
        else notify(translate(lang, 'hf_notif_work'), translate(lang, 'hf_notif_work_d', { r: round, n: pomodoro.workMin }))
      }
      return { ...s, phase: nextPhase, round, endsAt: nowMs + mins * 60_000, pausedRemaining: null, startedAt: nowMs }
    },
    [pomodoro, lang, logPhase, sounds],
  )

  // Phase transition (driver window only)
  useEffect(() => {
    if (!driver) return
    const s = ref.current
    if (!s || s.pausedRemaining !== null) return
    if (now >= s.endsAt) {
      const next = advance(s) // side effects (chime, notification) once, outside the updater
      setSession((cur) => (cur === s ? next : cur))
    }
  }, [now, advance, setSession, driver])

  const start = useCallback(
    (taskId: string | null) => {
      const nowMs = Date.now()
      setNow(nowMs)
      setSession(() => ({ phase: 'work', round: 1, endsAt: nowMs + pomodoro.workMin * 60_000, pausedRemaining: null, taskId, startedAt: nowMs }))
    },
    [pomodoro.workMin, setSession],
  )
  const pause = useCallback(() => setSession((s) => (s && s.pausedRemaining === null ? { ...s, pausedRemaining: Math.max(0, s.endsAt - Date.now()) } : s)), [setSession])
  // Resume moves `startedAt` forward by the pause length, so logged durations exclude pauses.
  const resume = useCallback(
    () =>
      setSession((s) => {
        if (!s || s.pausedRemaining === null) return s
        const nowMs = Date.now()
        const elapsed = Math.max(0, phaseMs(s, pomodoro) - s.pausedRemaining)
        return { ...s, endsAt: nowMs + s.pausedRemaining, pausedRemaining: null, startedAt: nowMs - elapsed }
      }),
    [setSession, pomodoro],
  )
  const skip = useCallback(() => {
    const s = ref.current
    if (!s) return
    const next = advance(s, true)
    setSession((cur) => (cur === s ? next : cur))
  }, [advance, setSession])
  const stop = useCallback(() => {
    const s = ref.current
    if (s) logPhase(s, Date.now())
    setSession(() => null)
  }, [logPhase, setSession])

  const totalMs = session ? phaseMs(session, pomodoro) : 0
  const remainingMs = session ? (session.pausedRemaining !== null ? session.pausedRemaining : Math.max(0, session.endsAt - now)) : 0

  return { session, remainingMs, totalMs, start, pause, resume, skip, stop }
}

export type HyperFocusState = ReturnType<typeof useHyperFocus>

/** m:ss countdown label. */
export function fmtCountdown(ms: number) {
  const s = Math.ceil(ms / 1000)
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, '0')}`
}

interface BarProps {
  hf: HyperFocusState
  task: Task | null
  /** Settings → "Hyper Focus silences other tasks": shows the 🔕 note during work rounds. */
  suppressOthers?: boolean
}

/** The active-session bar: progress ring, countdown, phase, round and controls. */
export function HyperFocusBar({ hf, task, suppressOthers = false }: BarProps) {
  const t = useT()
  const { session, remainingMs, totalMs } = hf
  const label = session ? (session.phase === 'work' ? t('hf_work') : t('hf_break')) : ''

  useEffect(() => {
    if (!session) return
    document.title = `${fmtCountdown(remainingMs)} · ${label} – Hyper Do`
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
        <span className="hf-time">{fmtCountdown(remainingMs)}</span>
      </div>
      <div className="hf-body">
        <div className="hf-head">
          <span className="hf-phase">{session.phase === 'work' ? '⚡' : '🧘'} {label}</span>
          <span className="chip">{t('hf_round', { n: session.round })}</span>
          {suppressOthers && session.phase === 'work' && !paused && <span className="chip muted">{t('hf_quiet')}</span>}
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

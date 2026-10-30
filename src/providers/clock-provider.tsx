import * as React from 'react'
import { fetchServerClock, type ServerClockSample } from '@/lib/api'
import { useAuth } from './auth-provider'

export type ClockTrust = 'resolving' | 'server' | 'device'

interface ClockContextValue {
  /**
   * Server-aligned now. This is the only time source the UI is allowed to
   * display or to compare against a schedule.
   */
  now: Date
  /** Milliseconds to add to the device clock to reach server time. */
  offsetMs: number
  /** 'server' once a sample has landed; 'device' if the sample never arrived. */
  trust: ClockTrust
  /**
   * Absolute device clock error in seconds. Over a minute means the phone's own
   * clock is visibly wrong, which is worth telling the user about.
   */
  skewSeconds: number
  /** Re-samples the server clock. */
  resync: () => Promise<void>
}

const ClockContext = React.createContext<ClockContextValue | null>(null)

/** How often to re-sample, to correct for device clock drift and sleep. */
const RESYNC_INTERVAL_MS = 5 * 60 * 1000

/**
 * The trusted clock.
 *
 * The app never displays `Date.now()` directly. Instead the database clock is
 * sampled once, the device-to-server offset is derived from it, and the ticking
 * display is `Date.now() + offset`. That keeps the clock smooth (one request,
 * not one per second) while staying anchored to the server, so a phone whose
 * clock is twenty minutes out still shows — and records — the right time.
 *
 * The offset is re-sampled every five minutes and whenever the app returns to
 * the foreground, because a suspended phone can drift.
 */
export function ClockProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth()
  const [sample, setSample] = React.useState<ServerClockSample | null>(null)
  const [trust, setTrust] = React.useState<ClockTrust>('resolving')
  const [tick, setTick] = React.useState(() => Date.now())

  const resync = React.useCallback(async () => {
    try {
      const next = await fetchServerClock()
      setSample(next)
      setTrust('server')
    } catch {
      // Falling back to the device clock is honest and labelled: the dashboard
      // shows a warning, and a check-in still takes its timestamp from the
      // server, so a wrong device clock cannot corrupt a record.
      setTrust((current) => (current === 'server' ? 'server' : 'device'))
    }
  }, [])

  // Sample on sign-in. `server_now()` is granted to anon as well, so the login
  // screen can show a trustworthy clock too.
  React.useEffect(() => {
    void resync()
  }, [resync, session?.user.id])

  React.useEffect(() => {
    const interval = window.setInterval(() => void resync(), RESYNC_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [resync])

  // A phone that has been asleep wakes with a stale offset.
  React.useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void resync()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [resync])

  // One timer drives the whole app's seconds display.
  React.useEffect(() => {
    const interval = window.setInterval(() => setTick(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  const offsetMs = sample?.offsetMs ?? 0
  const now = React.useMemo(() => new Date(tick + offsetMs), [tick, offsetMs])

  const value = React.useMemo<ClockContextValue>(
    () => ({
      now,
      offsetMs,
      trust,
      skewSeconds: Math.round(Math.abs(offsetMs) / 1000),
      resync,
    }),
    [now, offsetMs, trust, resync],
  )

  return <ClockContext.Provider value={value}>{children}</ClockContext.Provider>
}

export function useClock(): ClockContextValue {
  const context = React.useContext(ClockContext)
  if (!context) throw new Error('useClock must be used inside <ClockProvider>')
  return context
}

/**
 * A clock that ticks only once a minute.
 *
 * Views that render dates and durations do not need a per-second re-render;
 * subscribing them to the seconds clock would re-render a month grid 60 times a
 * minute for no visible change.
 */
export function useMinuteClock(): Date {
  const { now } = useClock()
  const minuteStamp = Math.floor(now.getTime() / 60_000)
  // The dependency is the minute, so the memo only changes once a minute even
  // though `now` changes every second.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return React.useMemo(() => new Date(minuteStamp * 60_000), [minuteStamp])
}

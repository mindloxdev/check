import * as React from 'react'

interface OnlineContextValue {
  /** The browser's own reachability flag. */
  isOnline: boolean
  /** True once a request has actually failed, even if navigator says online. */
  hasRecentFailure: boolean
  reportFailure: () => void
  reportSuccess: () => void
}

const OnlineContext = React.createContext<OnlineContextValue | null>(null)

/**
 * Connectivity state.
 *
 * `navigator.onLine` only reports whether a network interface is up — a phone
 * attached to office Wi-Fi with no internet route still reads "online". So the
 * API layer reports real failures here, and the offline banner shows when
 * either signal says there is a problem.
 */
export function OnlineProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = React.useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  )
  const [hasRecentFailure, setHasRecentFailure] = React.useState(false)

  React.useEffect(() => {
    const goOnline = () => {
      setIsOnline(true)
      // Give the connection the benefit of the doubt and let the next request
      // decide; a stale failure flag would keep the banner up forever.
      setHasRecentFailure(false)
    }
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  const value = React.useMemo<OnlineContextValue>(
    () => ({
      isOnline,
      hasRecentFailure,
      reportFailure: () => setHasRecentFailure(true),
      reportSuccess: () => setHasRecentFailure(false),
    }),
    [isOnline, hasRecentFailure],
  )

  return <OnlineContext.Provider value={value}>{children}</OnlineContext.Provider>
}

export function useOnline(): OnlineContextValue {
  const context = React.useContext(OnlineContext)
  if (!context) throw new Error('useOnline must be used inside <OnlineProvider>')
  return context
}

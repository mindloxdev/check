import * as React from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'

interface AuthContextValue {
  /** null once resolved and signed out; undefined while still resolving. */
  session: Session | null
  user: User | null
  /** True until the stored session has been read back from storage. */
  isLoading: boolean
  /** Set when Supabase itself is not configured. */
  isConfigured: boolean
}

const AuthContext = React.createContext<AuthContextValue | null>(null)

/**
 * Owns the Supabase auth session.
 *
 * `getSession()` resolves the persisted session on startup, which is what keeps
 * the user signed in between app launches. `onAuthStateChange` then keeps this
 * in step with token refreshes, sign-outs from another tab, and the recovery
 * link flow.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null>(null)
  const [isLoading, setIsLoading] = React.useState(isSupabaseConfigured)

  React.useEffect(() => {
    const supabase = getSupabase()
    if (!supabase) {
      setIsLoading(false)
      return
    }

    let cancelled = false

    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return
        setSession(data.session)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setIsLoading(false)
    })

    return () => {
      cancelled = true
      subscription.subscription.unsubscribe()
    }
  }, [])

  const value = React.useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      isLoading,
      isConfigured: isSupabaseConfigured,
    }),
    [session, isLoading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')
  return context
}

/** The signed-in user id, or null. */
export function useUserId(): string | null {
  return useAuth().user?.id ?? null
}

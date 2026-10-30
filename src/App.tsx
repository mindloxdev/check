import * as React from 'react'
import {
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { isSupabaseConfigured } from '@/lib/supabase'
import { useAuth } from '@/providers/auth-provider'
import { AppShell } from '@/components/layout/app-shell'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/toaster'
import { DashboardPage } from '@/pages/dashboard'
import { CalendarPage } from '@/pages/calendar'
import { ReportsPage } from '@/pages/reports'
import { HistoryPage } from '@/pages/history'
import { SettingsPage } from '@/pages/settings'
import { LoginPage } from '@/pages/login'
import { ResetPasswordPage } from '@/pages/reset-password'
import { SetupRequiredPage } from '@/pages/setup-required'
import { NotFoundPage } from '@/pages/not-found'

export default function App() {
  if (!isSupabaseConfigured) {
    return (
      <>
        <SetupRequiredPage />
        <Toaster />
      </>
    )
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Routes>
        {/* Reachable while signed out: the recovery link creates the session. */}
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        <Route
          path="/*"
          element={
            <RequireAuth>
              <AppShell>
                <Routes>
                  <Route index element={<DashboardPage />} />
                  <Route path="calendar" element={<CalendarPage />} />
                  <Route path="reports" element={<ReportsPage />} />
                  <Route path="history" element={<HistoryPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </AppShell>
            </RequireAuth>
          }
        />
      </Routes>
      <Toaster />
    </TooltipProvider>
  )
}

/**
 * Route guard.
 *
 * While the persisted session is still being read this renders a spinner rather
 * than the sign-in screen — otherwise every cold start would flash the login
 * page at an already-authenticated user.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div
        className="grid min-h-dvh place-items-center bg-background"
        role="status"
        aria-live="polite"
      >
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
          <p className="text-[13px] text-muted-foreground">Loading your attendance…</p>
        </div>
      </div>
    )
  }

  if (!session) {
    // The sign-in screen is rendered in place rather than redirected to, so the
    // URL the user asked for survives a page reload after signing in.
    return location.pathname === '/' ? (
      <LoginPage />
    ) : (
      <Navigate to="/" replace state={{ from: location.pathname }} />
    )
  }

  return <>{children}</>
}

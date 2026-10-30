import type * as React from 'react'
import { Link } from 'react-router-dom'
import { Building2, LogOut, Moon, Sun, SunMoon } from 'lucide-react'
import { signOut } from '@/lib/api'
import { usePolicy } from '@/hooks/use-attendance'
import { useAuth } from '@/providers/auth-provider'
import { useTheme } from '@/providers/theme-provider'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { BottomNav } from './bottom-nav'
import { cn } from '@/lib/utils'

/**
 * The application frame.
 *
 * Layout decisions:
 *   - A sticky top bar that stays under the status bar via safe-area padding.
 *   - `pb-nav` on the scroll container, so the last row of content is never
 *     trapped behind the fixed tab bar.
 *   - A `max-w-2xl` measure, so the app stays readable on a tablet instead of
 *     stretching a one-column phone layout across 1200 px.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <TopBar />
      <main
        id="main"
        className="mx-auto w-full max-w-2xl flex-1 px-4 pb-nav pt-4 sm:px-6"
      >
        {children}
      </main>
      <BottomNav />
    </div>
  )
}

function TopBar() {
  const { policy } = usePolicy()
  const { user } = useAuth()

  return (
    <header
      className={cn(
        'no-print sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur',
        'supports-[backdrop-filter]:bg-background/75 pt-[env(safe-area-inset-top,0px)]',
      )}
    >
      <div className="mx-auto flex h-14 w-full max-w-2xl items-center gap-3 px-4 sm:px-6">
        <Link
          to="/"
          className={cn(
            'flex min-w-0 items-center gap-2.5 rounded-lg py-1 pr-2',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Building2 className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold leading-tight">
              {policy.officeName}
            </span>
            <span className="block truncate text-[11px] leading-tight text-muted-foreground">
              Attendance
            </span>
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Account menu"
                className="rounded-full"
              >
                <span
                  className="grid size-7 place-items-center rounded-full bg-secondary text-[11px] font-bold text-secondary-foreground"
                  aria-hidden="true"
                >
                  {initialsOf(user?.email)}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel className="truncate">
                {user?.email ?? 'Signed in'}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/settings">Settings</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={() => void signOut()}>
                <LogOut aria-hidden="true" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}

const THEME_ORDER = ['system', 'light', 'dark'] as const
const THEME_ICON = { system: SunMoon, light: Sun, dark: Moon } as const
const THEME_LABEL = {
  system: 'Theme: follows your device',
  light: 'Theme: light',
  dark: 'Theme: dark',
} as const

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const Icon = THEME_ICON[theme]
  const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]!

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(next)}
      aria-label={`${THEME_LABEL[theme]}. Switch to ${next}.`}
      title={THEME_LABEL[theme]}
      className="rounded-full"
    >
      <Icon aria-hidden="true" />
    </Button>
  )
}

function initialsOf(email: string | null | undefined): string {
  if (!email) return '—'
  const local = email.split('@')[0] ?? ''
  const parts = local.split(/[._-]+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase()
  }
  return local.slice(0, 2).toUpperCase() || '—'
}

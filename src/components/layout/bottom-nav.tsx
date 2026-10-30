import { NavLink } from 'react-router-dom'
import { CalendarDays, FileBarChart, History, Home, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Bottom navigation — five destinations, which is the maximum that stays
 * tappable and legible on a 375 px screen.
 *
 * Each item is a real link, so the browser's back button and deep links both
 * behave: pressing back returns to the previous tab rather than leaving the app.
 */
const ITEMS = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/reports', label: 'Reports', icon: FileBarChart },
  { to: '/history', label: 'History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const

export function BottomNav() {
  return (
    <nav
      aria-label="Main"
      className={cn(
        'no-print fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95',
        'shadow-nav backdrop-blur supports-[backdrop-filter]:bg-card/80',
        // Extends the painted area into the home-indicator region so the bar
        // does not appear to float above a white strip.
        'pb-[env(safe-area-inset-bottom,0px)]',
      )}
    >
      <ul className="mx-auto flex h-navbar max-w-2xl items-stretch">
        {ITEMS.map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              // `end` only on the index route, so /calendar does not light up
              // Home as well.
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  // A full-height, full-width target: comfortably past the
                  // 44 px minimum in both axes.
                  'group flex h-full w-full cursor-pointer flex-col items-center justify-center gap-1',
                  'px-1 pt-1 text-[11px] font-semibold transition-colors duration-fast',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset',
                  'focus-visible:ring-ring',
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground active:text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'grid place-items-center rounded-full px-3 py-1 transition-colors duration-fast',
                      isActive ? 'bg-primary-soft' : 'bg-transparent',
                    )}
                  >
                    <Icon
                      className="size-5"
                      strokeWidth={isActive ? 2.4 : 1.9}
                      aria-hidden="true"
                    />
                  </span>
                  <span className="leading-none">{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

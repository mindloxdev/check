import { AlertTriangle, CloudOff, Clock3 } from 'lucide-react'
import { useOnline } from '@/providers/online-provider'
import { useClock } from '@/providers/clock-provider'
import { cn } from '@/lib/utils'

/**
 * Honest status strip.
 *
 * Three conditions get surfaced here rather than hidden, because each one
 * changes whether the user can trust what the screen says:
 *   1. offline — a tap will not be saved;
 *   2. the server clock could not be reached — the time shown is the device's;
 *   3. the device clock is far from the server's — worth knowing even though
 *      recorded timestamps always come from the server.
 */
export function ConnectionBanner({ className }: { className?: string }) {
  const { isOnline, hasRecentFailure } = useOnline()
  const { trust, skewSeconds } = useClock()

  const offline = !isOnline || hasRecentFailure
  const untrustedClock = trust === 'device'
  // One minute is the threshold at which a wrong phone clock becomes visible
  // against the schedule, so that is when it is worth mentioning.
  const skewed = trust === 'server' && skewSeconds >= 60

  if (!offline && !untrustedClock && !skewed) return null

  const items = [
    offline && {
      key: 'offline',
      icon: CloudOff,
      tone: 'destructive' as const,
      title: 'No connection',
      detail: 'Attendance cannot be saved right now. Nothing has been recorded.',
    },
    untrustedClock && {
      key: 'clock',
      icon: AlertTriangle,
      tone: 'caution' as const,
      title: 'Showing this device’s clock',
      detail: 'The server time could not be reached, so the time above may be wrong.',
    },
    skewed && {
      key: 'skew',
      icon: Clock3,
      tone: 'caution' as const,
      title: `This device’s clock is ${formatSkew(skewSeconds)} off`,
      detail: 'Times shown and recorded come from the server, so your attendance is accurate.',
    },
  ].filter(Boolean) as Array<{
    key: string
    icon: typeof CloudOff
    tone: 'destructive' | 'caution'
    title: string
    detail: string
  }>

  return (
    <div className={cn('space-y-2', className)} role="status" aria-live="polite">
      {items.map(({ key, icon: Icon, tone, title, detail }) => (
        <div
          key={key}
          className={cn(
            'flex items-start gap-2.5 rounded-xl border px-3 py-2.5',
            tone === 'destructive'
              ? 'border-destructive/25 bg-destructive-soft text-destructive-soft-foreground'
              : 'border-caution/25 bg-caution-soft text-caution-soft-foreground',
          )}
        >
          <Icon className="mt-px size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 space-y-0.5">
            <p className="text-[13px] font-semibold leading-tight">{title}</p>
            <p className="text-xs leading-relaxed opacity-90">{detail}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function formatSkew(seconds: number): string {
  if (seconds < 120) return `${seconds} seconds`
  const minutes = Math.round(seconds / 60)
  if (minutes < 120) return `${minutes} minutes`
  return `${Math.round(minutes / 60)} hours`
}

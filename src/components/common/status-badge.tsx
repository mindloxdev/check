import {
  Check,
  Clock,
  LogIn,
  LogOut,
  Minus,
  Moon,
  PartyPopper,
  Plane,
  PencilLine,
  X,
} from 'lucide-react'
import { STATUS_PRESENTATION, type DayStatus } from '@/lib/attendance'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const ICONS = {
  check: Check,
  clock: Clock,
  x: X,
  moon: Moon,
  party: PartyPopper,
  plane: Plane,
  login: LogIn,
  logout: LogOut,
  dash: Minus,
} as const

export interface StatusBadgeProps {
  status: DayStatus
  /** Appends a pencil mark when the day has been corrected by hand. */
  corrected?: boolean
  className?: string
}

/**
 * A status badge.
 *
 * Every badge pairs a colour with an icon *and* a text label, so the status
 * never depends on colour alone — the requirement that matters for a
 * colour-blind reader and for a greyscale printout.
 */
export function StatusBadge({ status, corrected, className }: StatusBadgeProps) {
  const presentation = STATUS_PRESENTATION[status]
  const Icon = ICONS[presentation.icon]

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <Badge className={cn('border', presentation.badgeClass)}>
        <Icon aria-hidden="true" />
        {presentation.label}
      </Badge>
      {corrected ? (
        <Badge variant="neutral" className="border" title="Manually corrected">
          <PencilLine aria-hidden="true" />
          <span className="sr-only sm:not-sr-only">Corrected</span>
        </Badge>
      ) : null}
    </span>
  )
}

/** The small colour key used by the calendar and the reports legend. */
export function StatusDot({
  status,
  className,
}: {
  status: DayStatus
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        STATUS_PRESENTATION[status].dotClass,
        className,
      )}
      aria-hidden="true"
    />
  )
}

export const LEGEND_STATUSES: DayStatus[] = [
  'present',
  'late',
  'absent',
  'missing_check_out',
  'leave',
  'weekend',
]

export function StatusLegend({ className }: { className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-3 gap-y-1.5', className)}>
      {LEGEND_STATUSES.map((status) => (
        <li key={status} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <StatusDot status={status} />
          {STATUS_PRESENTATION[status].label}
        </li>
      ))}
    </ul>
  )
}

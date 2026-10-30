import type * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

export interface StatCardProps {
  label: string
  /** Already formatted. Pass an em dash for "no data", never a zero. */
  value: React.ReactNode
  hint?: React.ReactNode
  icon?: LucideIcon
  tone?: 'default' | 'success' | 'warning' | 'destructive' | 'info' | 'caution'
  className?: string
  loading?: boolean
}

const TONE_RING: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'bg-primary-soft text-primary',
  success: 'bg-success-soft text-success-soft-foreground',
  warning: 'bg-warning-soft text-warning-soft-foreground',
  destructive: 'bg-destructive-soft text-destructive-soft-foreground',
  info: 'bg-info-soft text-info-soft-foreground',
  caution: 'bg-caution-soft text-caution-soft-foreground',
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
  className,
  loading,
}: StatCardProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-card p-3.5 shadow-card',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-[11px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground">
          {label}
        </p>
        {Icon ? (
          <span
            className={cn(
              'grid size-7 shrink-0 place-items-center rounded-lg',
              TONE_RING[tone],
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
          </span>
        ) : null}
      </div>

      {loading ? (
        <Skeleton className="h-7 w-16" />
      ) : (
        <p className="tnum truncate text-xl font-bold leading-none tracking-tight text-foreground">
          {value}
        </p>
      )}

      {hint ? (
        <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

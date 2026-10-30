import type * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
  /** Renders in the error palette for a failed load. */
  tone?: 'neutral' | 'error'
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  tone = 'neutral',
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed',
        'px-6 py-10 text-center',
        tone === 'error' ? 'border-destructive/30 bg-destructive-soft/40' : 'border-border bg-card',
        className,
      )}
    >
      <span
        className={cn(
          'grid size-11 place-items-center rounded-full',
          tone === 'error'
            ? 'bg-destructive-soft text-destructive-soft-foreground'
            : 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-[32ch] text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  )
}

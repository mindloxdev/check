import type * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * A stable-size placeholder. Reserving the final height here is what keeps
 * cumulative layout shift at zero while the first query resolves.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('skeleton', className)} aria-hidden="true" {...props} />
}

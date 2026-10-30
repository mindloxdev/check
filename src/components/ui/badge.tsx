import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ' +
    'font-semibold leading-tight [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border-primary/20 bg-primary-soft text-primary',
        neutral: 'border-border bg-muted text-muted-foreground',
        outline: 'border-border bg-transparent text-foreground',
        success: 'border-success/20 bg-success-soft text-success-soft-foreground',
        warning: 'border-warning/20 bg-warning-soft text-warning-soft-foreground',
        caution: 'border-caution/20 bg-caution-soft text-caution-soft-foreground',
        destructive:
          'border-destructive/20 bg-destructive-soft text-destructive-soft-foreground',
        info: 'border-info/20 bg-info-soft text-info-soft-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

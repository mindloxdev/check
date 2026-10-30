import { Toaster as Sonner } from 'sonner'
import { useTheme } from '@/providers/theme-provider'

/**
 * Toasts are positioned top-centre on phones: the bottom edge belongs to the
 * tab bar and the primary action button, and a toast there would cover them.
 */
export function Toaster() {
  const { resolvedTheme } = useTheme()
  return (
    <Sonner
      theme={resolvedTheme}
      position="top-center"
      closeButton
      richColors={false}
      duration={5000}
      gap={8}
      offset={12}
      toastOptions={{
        classNames: {
          toast:
            'group rounded-xl border border-border bg-card text-card-foreground shadow-card-lg',
          title: 'text-sm font-semibold',
          description: 'text-[13px] text-muted-foreground leading-relaxed',
          actionButton: 'bg-primary text-primary-foreground rounded-md text-xs font-semibold',
          cancelButton: 'bg-muted text-muted-foreground rounded-md text-xs font-semibold',
          closeButton: 'bg-card border-border text-muted-foreground',
          success: 'border-success/30',
          error: 'border-destructive/30',
          warning: 'border-warning/30',
        },
      }}
    />
  )
}

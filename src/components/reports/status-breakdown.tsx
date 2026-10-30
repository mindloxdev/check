import * as React from 'react'
import { STATUS_PRESENTATION } from '@/lib/attendance'
import { type MonthlyReport, statusBreakdown } from '@/lib/report'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusDot } from '@/components/common/status-badge'
import { cn } from '@/lib/utils'

/**
 * How the month broke down, by status.
 *
 * Deliberately *not* a chart. Six status categories need six hues, and three of
 * them (late, incomplete, absent) sit in the warm red-orange-yellow arc, which
 * collapses under deuteranopia no matter how the steps are chosen — the
 * validator rejected every candidate palette at the normal-vision floor, let
 * alone the CVD one.
 *
 * A directly-labelled proportion list carries the same information with the
 * identity in the *text*: a single-hue bar encodes magnitude, the label names
 * the category, and the coloured dot is a cue back to the calendar rather than
 * the only way to tell two rows apart. It also reads better on a 375 px screen
 * than a six-slice pie.
 */
export function StatusBreakdown({
  report,
  className,
}: {
  report: MonthlyReport
  className?: string
}) {
  const slices = React.useMemo(() => statusBreakdown(report), [report])
  const total = slices.reduce((sum, slice) => sum + slice.count, 0)

  if (total === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Month breakdown</CardTitle>
          <CardDescription>Nothing recorded for {report.label} yet.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const max = Math.max(...slices.map((slice) => slice.count))

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle>Month breakdown</CardTitle>
        <CardDescription>
          All {total} days in {report.label}, by recorded status.
        </CardDescription>
      </CardHeader>

      <div className="space-y-2 px-4 pb-4 sm:px-5 sm:pb-5">
        {slices.map((slice) => {
          const share = Math.round((slice.count / total) * 100)
          return (
            <div key={slice.status} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-foreground">
                  <StatusDot status={slice.status} />
                  <span className="truncate">{slice.label}</span>
                </p>
                <p className="tnum shrink-0 text-[13px] font-semibold text-muted-foreground">
                  {slice.count}
                  <span className="ml-1 text-[11px] font-normal">({share}%)</span>
                </p>
              </div>
              {/* Magnitude in one hue; identity lives in the label above. */}
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`${slice.label}: ${slice.count} of ${total} days, ${share}%`}
              >
                <div
                  className={cn('h-full rounded-full', STATUS_PRESENTATION[slice.status].dotClass)}
                  style={{ width: `${Math.max((slice.count / max) * 100, 3)}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

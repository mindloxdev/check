import * as React from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { STATUS_PRESENTATION } from '@/lib/attendance'
import { type MonthlyReport, dailyHoursSeries, type DailyHoursPoint } from '@/lib/report'
import { useTheme } from '@/providers/theme-provider'
import { formatDuration, formatShortDate } from '@/lib/tz'
import { AXIS_STYLE, GRID_DASH, chartTheme } from './chart-theme'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * Worked hours per day, against the expected-hours target.
 *
 * Form: a time axis with 28-31 points and one measure — a line/area chart.
 * One series, so there is no legend box; the title names the measure and the
 * target line is labelled directly on the plot.
 *
 * `connectNulls` is deliberately off: a day with no completed session is a gap,
 * not a zero, and drawing a line through it would invent data.
 */
export function HoursChart({
  report,
  onSelectDay,
  className,
}: {
  report: MonthlyReport
  onSelectDay?: (dateKey: string) => void
  className?: string
}) {
  const { resolvedTheme } = useTheme()
  const theme = chartTheme(resolvedTheme)
  const data = React.useMemo(() => dailyHoursSeries(report), [report])

  const target = data[0]?.targetHours ?? 8
  const recorded = data.filter((point) => point.hours != null)
  const maxHours = Math.max(target, ...recorded.map((point) => point.hours ?? 0))
  // A whole-hour ceiling keeps every tick label two characters wide ("10h" at
  // most), which is what lets the axis stay narrow enough for a 375 px screen
  // without clipping the topmost label.
  const yMax = Math.max(1, Math.ceil(maxHours + 0.5))

  if (recorded.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Daily working hours</CardTitle>
          <CardDescription>
            No completed sessions in {report.label} yet, so there is nothing to plot.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="pb-2">
        <CardTitle>Daily working hours</CardTitle>
        <CardDescription>
          Against the expected {formatDuration(target * 60)} day. Gaps are days with no
          completed session.
        </CardDescription>
      </CardHeader>

      <div className="h-52 w-full px-1 pb-2 pr-3 sm:h-60">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: -8 }}
            onClick={(event) => {
              const point = event?.activePayload?.[0]?.payload as DailyHoursPoint | undefined
              if (point && onSelectDay) onSelectDay(point.dateKey)
            }}
          >
            <defs>
              <linearGradient id="hours-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={theme.series} stopOpacity={0.26} />
                <stop offset="100%" stopColor={theme.series} stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid
              strokeDasharray={GRID_DASH}
              stroke={theme.grid}
              vertical={false}
            />
            <XAxis
              dataKey="label"
              stroke={theme.axis}
              tick={{ fill: theme.axisText, ...AXIS_STYLE }}
              tickLine={false}
              axisLine={{ stroke: theme.axis }}
              // Every third day keeps the axis readable at 375 px.
              interval={2}
              minTickGap={4}
            />
            <YAxis
              stroke={theme.axis}
              tick={{ fill: theme.axisText, ...AXIS_STYLE }}
              tickLine={false}
              axisLine={false}
              domain={[0, yMax]}
              allowDecimals={false}
              width={34}
              tickFormatter={(value: number) => `${value}h`}
            />

            {/* The target is an annotation, labelled on the plot rather than in
                a legend, so it reads without a colour key. */}
            <ReferenceLine
              y={target}
              stroke={theme.target}
              strokeDasharray="5 4"
              strokeWidth={1.5}
              label={{
                value: `target ${target}h`,
                position: 'insideTopRight',
                fill: theme.axisText,
                fontSize: 10,
                fontWeight: 600,
              }}
            />

            <Tooltip
              cursor={{ stroke: theme.axis, strokeWidth: 1, strokeDasharray: '3 3' }}
              content={<HoursTooltip />}
            />

            <Area
              type="monotone"
              dataKey="hours"
              stroke={theme.series}
              strokeWidth={2}
              fill="url(#hours-fill)"
              // A gap stays a gap.
              connectNulls={false}
              dot={false}
              activeDot={{
                r: 4.5,
                fill: theme.series,
                // A 2 px surface ring keeps the marker legible over the fill.
                stroke: theme.surface,
                strokeWidth: 2,
              }}
              isAnimationActive={false}
              name="Worked hours"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

interface TooltipProps {
  active?: boolean
  payload?: Array<{ payload: DailyHoursPoint }>
}

function HoursTooltip({ active, payload }: TooltipProps) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null

  return (
    <div className="rounded-lg border border-border bg-popover px-2.5 py-2 shadow-card-lg">
      <p className="text-[11px] font-bold text-popover-foreground">
        {formatShortDate(point.dateKey)}
      </p>
      <p className="tnum text-xs text-muted-foreground">
        {point.hours == null
          ? 'No completed session'
          : `${formatDuration(Math.round(point.hours * 60))} worked`}
      </p>
      <p className="text-[11px] text-muted-foreground">
        {STATUS_PRESENTATION[point.status].label}
        {point.lateMinutes > 0 ? ` · ${point.lateMinutes}m late` : ''}
      </p>
    </div>
  )
}

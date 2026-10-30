import * as React from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { type MonthlyReport, weekdayPunctuality, type WeekdayPunctualityPoint } from '@/lib/report'
import { useTheme } from '@/providers/theme-provider'
import { AXIS_STYLE, GRID_DASH, chartTheme } from './chart-theme'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * Arrivals by weekday, split on-time vs late.
 *
 * Two series, so a legend is always present, and `LabelList` prints the count on
 * every bar — the on-time/late pair sits in the 6-8 deuteranopia ΔE band, which
 * the method allows only alongside secondary encoding like this. A 2 px gap
 * (`barGap`) separates the adjacent bars so the two fills never touch.
 */
export function PunctualityChart({
  report,
  className,
}: {
  report: MonthlyReport
  className?: string
}) {
  const { resolvedTheme } = useTheme()
  const theme = chartTheme(resolvedTheme)
  const data = React.useMemo(() => weekdayPunctuality(report), [report])

  const total = data.reduce((sum, point) => sum + point.onTime + point.late, 0)
  if (total === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Arrivals by weekday</CardTitle>
          <CardDescription>
            No arrivals recorded in {report.label} yet.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const maxStack = Math.max(...data.map((point) => point.onTime + point.late), 1)

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="pb-2">
        <CardTitle>Arrivals by weekday</CardTitle>
        <CardDescription>
          Which day of the week tends to run late, across {report.label}.
        </CardDescription>
      </CardHeader>

      <div className="h-48 w-full px-1 pb-1 pr-3 sm:h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 14, right: 8, bottom: 0, left: -14 }}
            barGap={2}
            barCategoryGap="22%"
          >
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
            />
            <YAxis
              stroke={theme.axis}
              tick={{ fill: theme.axisText, ...AXIS_STYLE }}
              tickLine={false}
              axisLine={false}
              width={30}
              allowDecimals={false}
              domain={[0, Math.max(maxStack, 2)]}
            />
            <Tooltip
              cursor={{ fill: theme.grid, fillOpacity: 0.45 }}
              content={<PunctualityTooltip />}
            />
            <Legend
              verticalAlign="top"
              align="right"
              height={24}
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 11, fontWeight: 600, color: theme.axisText }}
            />
            <Bar
              dataKey="onTime"
              name="On time"
              fill={theme.onTime}
              radius={[4, 4, 0, 0]}
              maxBarSize={18}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="onTime"
                position="top"
                formatter={hideZero}
                fill={theme.axisText}
                fontSize={9}
                fontWeight={700}
              />
            </Bar>
            <Bar
              dataKey="late"
              name="Late"
              fill={theme.late}
              radius={[4, 4, 0, 0]}
              maxBarSize={18}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="late"
                position="top"
                formatter={hideZero}
                fill={theme.axisText}
                fontSize={9}
                fontWeight={700}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

/** A zero is better shown as an empty slot than as a "0" on every weekday. */
function hideZero(value: unknown): string {
  return typeof value === 'number' && value > 0 ? String(value) : ''
}

interface TooltipProps {
  active?: boolean
  payload?: Array<{ payload: WeekdayPunctualityPoint }>
}

function PunctualityTooltip({ active, payload }: TooltipProps) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null

  return (
    <div className="rounded-lg border border-border bg-popover px-2.5 py-2 shadow-card-lg">
      <p className="text-[11px] font-bold text-popover-foreground">{point.label}</p>
      <p className="tnum text-xs text-muted-foreground">
        {point.onTime} on time · {point.late} late
      </p>
      {point.late > 0 ? (
        <p className="tnum text-[11px] text-muted-foreground">
          {point.averageLateMinutes}m average delay
        </p>
      ) : null}
    </div>
  )
}

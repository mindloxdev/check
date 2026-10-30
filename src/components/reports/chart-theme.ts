/**
 * Chart palette.
 *
 * Every value here was produced by the dataviz validator rather than by eye:
 *
 *   node scripts/validate_palette.js "#15803D,#C2410C" --mode light --surface "#FFFFFF"
 *   node scripts/validate_palette.js "#2BAE5F,#DD7018" --mode dark  --surface "#172135"
 *   node scripts/validate_palette.js "#4338CA" --mode light ; "#7C73F0" --mode dark
 *
 * Results: all checks pass in both modes. The on-time/late pair sits in the 6-8
 * deuteranopia band (ΔE 7.0 light, 7.0 dark), which the method permits only with
 * secondary encoding — so both charts carry a legend, direct value labels, and a
 * 2 px surface gap between adjacent bars. Colour is never the only signal.
 *
 * The dark steps are *selected*, not an automatic inversion: the dark lightness
 * band is narrower (L 0.48-0.67) than the light one, so the light steps fail it
 * and needed re-stepping.
 */

export interface ChartTheme {
  /** Single-series accent for the worked-hours trend. */
  series: string
  /** Fill under the hours line. */
  seriesFill: string
  /** Status pair for the punctuality chart. */
  onTime: string
  late: string
  /** The expected-hours reference line. */
  target: string
  grid: string
  axis: string
  axisText: string
  tooltipBg: string
  tooltipBorder: string
  tooltipText: string
  tooltipMuted: string
  /** Surface colour, used for the 2 px gap between adjacent marks. */
  surface: string
}

const LIGHT: ChartTheme = {
  series: '#4338CA',
  seriesFill: 'rgba(67, 56, 202, 0.16)',
  onTime: '#15803D',
  late: '#C2410C',
  target: '#64748B',
  grid: '#E2E5EA',
  axis: '#CBD5E1',
  axisText: '#4B5563',
  tooltipBg: '#FFFFFF',
  tooltipBorder: '#E2E5EA',
  tooltipText: '#1E293B',
  tooltipMuted: '#4B5563',
  surface: '#FFFFFF',
}

const DARK: ChartTheme = {
  series: '#7C73F0',
  seriesFill: 'rgba(124, 115, 240, 0.20)',
  onTime: '#2BAE5F',
  late: '#DD7018',
  target: '#94A3B8',
  grid: '#2A3447',
  axis: '#3A465C',
  axisText: '#AFB9C9',
  tooltipBg: '#1C2740',
  tooltipBorder: '#3A465C',
  tooltipText: '#E2E8F0',
  tooltipMuted: '#AFB9C9',
  surface: '#172135',
}

export function chartTheme(mode: 'light' | 'dark'): ChartTheme {
  return mode === 'dark' ? DARK : LIGHT
}

/** Shared axis/grid styling so every chart in the app reads as one system. */
export const AXIS_STYLE = {
  fontSize: 10,
  fontWeight: 600,
} as const

/** Recessive grid: visible enough to read a value against, never competing. */
export const GRID_DASH = '3 3'

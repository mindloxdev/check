import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AttendanceRecordRow } from '@/types/database'
import { DEFAULT_POLICY, deriveLiveState, summariseDay } from '@/lib/attendance'
import { zonedWallClockToInstant } from '@/lib/tz'

// ---------------------------------------------------------------------------
// Module mocks. The components under test are the UI contract; the data layer
// has its own tests, so it is stubbed here rather than exercised twice.
// ---------------------------------------------------------------------------

const checkInMutate = vi.fn()
const checkOutMutate = vi.fn()
const onlineState = { isOnline: true, hasRecentFailure: false }

vi.mock('@/hooks/use-attendance', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/use-attendance')>(
    '@/hooks/use-attendance',
  )
  return {
    ...actual,
    useCheckIn: () => ({ mutate: checkInMutate, isPending: false }),
    useCheckOut: () => ({ mutate: checkOutMutate, isPending: false }),
    usePolicy: () => ({ policy: DEFAULT_POLICY, profile: undefined }),
    useAuditLog: () => ({ data: [], isLoading: false, error: null }),
    useManualCorrection: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteRecord: () => ({ mutate: vi.fn(), isPending: false }),
  }
})

vi.mock('@/providers/online-provider', () => ({
  useOnline: () => ({
    ...onlineState,
    reportFailure: vi.fn(),
    reportSuccess: vi.fn(),
  }),
  OnlineProvider: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('@/providers/theme-provider', () => ({
  useTheme: () => ({ theme: 'light', resolvedTheme: 'light', setTheme: vi.fn() }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}))

// Imported after the mocks so they pick them up.
const { StatusCard } = await import('./status-card')
const { ActionButton } = await import('./action-button')
const { DailyTable } = await import('@/components/reports/daily-table')
const { MonthCalendar } = await import('@/components/calendar/month-calendar')

const KARACHI = 'Asia/Karachi'
const TODAY = '2026-10-29'

function record(
  date: string,
  inTime: string | null,
  outTime: string | null,
  overrides: Partial<AttendanceRecordRow> = {},
): AttendanceRecordRow {
  const checkIn = inTime ? zonedWallClockToInstant(date, inTime, KARACHI) : null
  const checkOut = outTime ? zonedWallClockToInstant(date, outTime, KARACHI) : null
  return {
    id: `r-${date}-${inTime ?? 'x'}`,
    user_id: 'u1',
    attendance_date: date,
    session_index: 1,
    check_in_at: checkIn?.toISOString() ?? null,
    check_out_at: checkOut?.toISOString() ?? null,
    check_in_verification_status: checkIn ? 'verified' : null,
    check_out_verification_status: checkOut ? 'verified' : null,
    check_in_source: checkIn ? 'app' : null,
    check_out_source: checkOut ? 'app' : null,
    check_in_client_skew_seconds: null,
    check_out_client_skew_seconds: null,
    manual_correction: false,
    correction_reason: null,
    note: null,
    policy_snapshot: {},
    duration_minutes:
      checkIn && checkOut
        ? Math.floor((checkOut.getTime() - checkIn.getTime()) / 60_000)
        : null,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...overrides,
  }
}

const NOW = zonedWallClockToInstant(TODAY, '11:30', KARACHI)

beforeEach(() => {
  checkInMutate.mockClear()
  checkOutMutate.mockClear()
  onlineState.isOnline = true
  onlineState.hasRecentFailure = false
})

// ---------------------------------------------------------------------------

describe('StatusCard', () => {
  it('shows em dashes, never zeros, before anything is recorded', () => {
    const state = deriveLiveState({
      now: NOW,
      todayRecords: [],
      openSession: null,
      policy: DEFAULT_POLICY,
    })
    render(<StatusCard state={state} policy={DEFAULT_POLICY} />)

    expect(screen.getAllByText('Not Checked In').length).toBeGreaterThan(0)
    expect(screen.getByText('Thursday, October 29, 2026')).toBeInTheDocument()

    const checkIn = screen.getByText('Check in').closest('div')!
    expect(within(checkIn).getByText('—')).toBeInTheDocument()
    expect(within(checkIn).queryByText('00:00')).not.toBeInTheDocument()
  })

  it('shows the recorded times and the running duration once checked in', () => {
    const open = record(TODAY, '09:00', null)
    const state = deriveLiveState({
      now: NOW,
      todayRecords: [open],
      openSession: open,
      policy: DEFAULT_POLICY,
    })
    render(<StatusCard state={state} policy={DEFAULT_POLICY} />)

    expect(screen.getAllByText('Checked In').length).toBeGreaterThan(0)
    expect(screen.getByText('09:00 AM')).toBeInTheDocument()
    expect(screen.getByText('2h 30m')).toBeInTheDocument()
    expect(screen.getByText('On time')).toBeInTheDocument()
  })

  it('labels a late arrival with the minutes past the scheduled time', () => {
    const open = record(TODAY, '09:24', null)
    const state = deriveLiveState({
      now: NOW,
      todayRecords: [open],
      openSession: open,
      policy: DEFAULT_POLICY,
    })
    render(<StatusCard state={state} policy={DEFAULT_POLICY} />)
    expect(screen.getByText('24m late')).toBeInTheDocument()
  })

  it('warns when the open session was carried over from an earlier day', () => {
    const stale = record('2026-10-28', '09:00', null)
    const state = deriveLiveState({
      now: NOW,
      todayRecords: [],
      openSession: stale,
      policy: DEFAULT_POLICY,
    })
    render(<StatusCard state={state} policy={DEFAULT_POLICY} />)
    expect(screen.getByText(/never closed/i)).toBeInTheDocument()
    expect(screen.getByText('2026-10-28')).toBeInTheDocument()
  })
})

describe('ActionButton', () => {
  const policy = DEFAULT_POLICY

  it('offers only Check In when nothing is recorded', async () => {
    const state = deriveLiveState({
      now: NOW,
      todayRecords: [],
      openSession: null,
      policy,
    })
    render(<ActionButton state={state} policy={policy} wifiMode="off" />)

    const button = screen.getByRole('button', { name: /check in/i })
    expect(button).toBeEnabled()
    expect(screen.queryByRole('button', { name: /check out/i })).not.toBeInTheDocument()

    await userEvent.click(button)
    expect(checkInMutate).toHaveBeenCalledTimes(1)
    expect(checkOutMutate).not.toHaveBeenCalled()
  })

  it('offers only Check Out while a session is open', async () => {
    const open = record(TODAY, '09:00', null)
    const state = deriveLiveState({
      now: NOW,
      todayRecords: [open],
      openSession: open,
      policy,
    })
    render(<ActionButton state={state} policy={policy} wifiMode="off" />)

    expect(screen.queryByRole('button', { name: /^check in$/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /check out/i }))
    expect(checkOutMutate).toHaveBeenCalledTimes(1)
  })

  it('disables both actions once the day is complete', () => {
    const done = record(TODAY, '09:00', '17:00')
    const state = deriveLiveState({
      now: NOW,
      todayRecords: [done],
      openSession: null,
      policy,
    })
    render(<ActionButton state={state} policy={policy} wifiMode="off" />)

    const button = screen.getByRole('button', { name: /day complete/i })
    expect(button).toBeDisabled()
  })

  it('refuses to record while offline and says nothing was saved', () => {
    onlineState.isOnline = false
    const state = deriveLiveState({
      now: NOW,
      todayRecords: [],
      openSession: null,
      policy,
    })
    render(<ActionButton state={state} policy={policy} wifiMode="off" />)

    expect(screen.getByRole('button', { name: /offline/i })).toBeDisabled()
    // The "not" is wrapped in <strong>, so match on the paragraph's full text
    // rather than a regex that would have to span element boundaries.
    const explanation = screen.getByText(/There is no trusted clock offline/i)
    expect(explanation.textContent).toMatch(/your attendance has\s*not\s*been recorded/i)
    expect(checkInMutate).not.toHaveBeenCalled()
  })

  it('offers to note an offline tap without claiming it was recorded', async () => {
    onlineState.isOnline = false
    const state = deriveLiveState({
      now: NOW,
      todayRecords: [],
      openSession: null,
      policy,
    })
    render(<ActionButton state={state} policy={policy} wifiMode="off" />)

    const note = screen.getByRole('button', { name: /note the time on this device/i })
    await userEvent.click(note)
    // Queued locally only — no write was attempted.
    expect(checkInMutate).not.toHaveBeenCalled()
    expect(localStorage.getItem('oat.pending-intents.v1')).toContain('check_in')
  })

  it('asks for confirmation before an unverified check-in in required mode', async () => {
    const state = deriveLiveState({
      now: NOW,
      todayRecords: [],
      openSession: null,
      policy,
    })
    render(<ActionButton state={state} policy={policy} wifiMode="required" />)

    await userEvent.click(screen.getByRole('button', { name: /check in/i }))
    // The write must not happen until the user confirms.
    expect(checkInMutate).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /check in anyway/i }))
    expect(checkInMutate).toHaveBeenCalledTimes(1)
  })
})

describe('DailyTable', () => {
  const days = [
    summariseDay({
      dateKey: '2026-10-01',
      records: [record('2026-10-01', '09:02', '17:15')],
      policy: DEFAULT_POLICY,
      today: TODAY,
    }),
    summariseDay({
      dateKey: '2026-10-02',
      records: [record('2026-10-02', '09:24', '17:30')],
      policy: DEFAULT_POLICY,
      today: TODAY,
    }),
    summariseDay({
      dateKey: '2026-10-03',
      records: [],
      policy: DEFAULT_POLICY,
      today: TODAY,
    }),
  ]

  it('renders a row per day with the status spelled out, not just coloured', () => {
    render(<DailyTable days={days} onSelectDay={vi.fn()} today={TODAY} />)
    expect(screen.getAllByText('Present').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Late').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Weekend').length).toBeGreaterThan(0)
  })

  it('reports Late By as 0m inside the grace window', () => {
    render(<DailyTable days={days} onSelectDay={vi.fn()} today={TODAY} />)
    // 09:02 is within the 10-minute grace, so it must not read "2m".
    expect(screen.getAllByText('0m').length).toBeGreaterThan(0)
    expect(screen.getAllByText('24m').length).toBeGreaterThan(0)
  })

  it('opens the day when a row is activated', async () => {
    const onSelect = vi.fn()
    render(<DailyTable days={days} onSelectDay={onSelect} today={TODAY} />)
    const rows = screen.getAllByRole('button', { name: /Oct|01|02/ })
    await userEvent.click(rows[0]!)
    expect(onSelect).toHaveBeenCalled()
  })

  it('counts the visible days and hides nothing by default', () => {
    render(<DailyTable days={days} onSelectDay={vi.fn()} today={TODAY} />)
    expect(screen.getByText('3 of 3 days shown')).toBeInTheDocument()
  })
})

describe('MonthCalendar', () => {
  const days = [
    summariseDay({
      dateKey: '2026-10-01',
      records: [record('2026-10-01', '09:02', '17:15')],
      policy: DEFAULT_POLICY,
      today: TODAY,
    }),
    summariseDay({
      dateKey: '2026-10-02',
      records: [record('2026-10-02', '09:24', '17:30')],
      policy: DEFAULT_POLICY,
      today: TODAY,
    }),
  ]

  it('names each day with its status so colour is never the only cue', () => {
    render(
      <MonthCalendar days={days} today={TODAY} selected={null} onSelect={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: '1 Present' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2 Late' })).toBeInTheDocument()
  })

  it('keeps exactly one cell in the tab order', () => {
    render(
      <MonthCalendar days={days} today={TODAY} selected="2026-10-02" onSelect={vi.fn()} />,
    )
    const focusable = screen
      .getAllByRole('button')
      .filter((element) => element.getAttribute('tabindex') === '0')
    expect(focusable).toHaveLength(1)
    expect(focusable[0]).toHaveAccessibleName('2 Late')
  })

  it('moves focus with the arrow keys', async () => {
    render(
      <MonthCalendar days={days} today={TODAY} selected="2026-10-01" onSelect={vi.fn()} />,
    )
    const first = screen.getByRole('button', { name: '1 Present' })
    first.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('button', { name: '2 Late' })).toHaveFocus()
  })

  it('selects a day on click', async () => {
    const onSelect = vi.fn()
    render(
      <MonthCalendar days={days} today={TODAY} selected={null} onSelect={onSelect} />,
    )
    await userEvent.click(screen.getByRole('button', { name: '2 Late' }))
    expect(onSelect).toHaveBeenCalledWith('2026-10-02')
  })
})

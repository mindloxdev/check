# Office Attendance Tracker

A personal, mobile-first attendance tracker. Arrive at the office, open the app,
tap **Check In**. Tap **Check Out** when you leave. Review the month on the 5th.

Built for one person's own record — not an HR system, no managers, no approvals.

```
React 18 · TypeScript · Vite · Tailwind · shadcn/ui · Recharts
Supabase (PostgreSQL + Auth + Row Level Security) · Vercel
```

---

## What makes it trustworthy

Three design decisions do most of the work:

**1. The clock belongs to the server.**
Every recorded instant comes from `now()` inside a PostgreSQL function. A wrong
phone clock, a tampered client, or a stale cached page cannot produce a
timestamp. The device clock is sent along *only* so the app can store the drift
and warn you that your phone is 14 minutes fast — it never becomes the record.

**2. Nothing changes silently.**
A trigger on `attendance_records` writes a before/after pair to an append-only
audit log for every insert, update and delete — including writes made straight
at the table through the REST API. Corrections require a reason, enforced by a
CHECK constraint, so no code path can skip it.

**3. Changing your schedule does not rewrite history.**
The policy in force is snapshotted onto each record when it is written. Move
your start time to 09:30 today and last month's 09:20 arrivals stay exactly as
they were classified.

---

## Quick start

```bash
npm install
cp .env.example .env.local     # fill in your Supabase URL and anon key
npm run dev
```

Then apply the database schema:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Full walkthrough: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

Without the environment variables the app renders a setup screen telling you
what is missing, rather than a blank page.

---

## Features

### Dashboard
Live clock in your office time zone, drawn from the server and labelled with
which clock it is using. A status card showing today at a glance, one large
check-in or check-out button, today's recorded times, the month to date, and
recent history.

### Check-in and check-out
One tap. Duplicate check-ins are impossible: the server refuses a second one
while a session is open, and the unique constraint
`(user_id, attendance_date, session_index)` backs that up even against two
phones tapping at once. Checking out closes whichever session is open, so a
departure after midnight — or after the month rolls over — lands on the right
record.

### Office Wi-Fi verification
A browser **cannot** read your Wi-Fi name, and this app does not pretend
otherwise. Instead it probes a small endpoint that only exists on your office
LAN and checks it returns your secret token. A failed probe never discards
attendance — the record is written and marked unverified.
See **[docs/WIFI_VERIFICATION.md](docs/WIFI_VERIFICATION.md)**.

### Calendar
A month grid with a clear state per day. Every cell is a 44 px target, names its
status in its accessible label, and is reachable with the arrow keys. Tap a day
for its timestamps, duration, lateness, verification result and full correction
history.

### Monthly report
Twelve summary statistics, a daily-hours trend against your expected day, an
arrivals-by-weekday breakdown, a month composition, and a sortable, filterable
daily table. Export as **CSV**, **Excel (.xlsx)**, **PDF**, or print.

### History
Search by date, filter by range, sort, open any day, correct it, export the
selection.

### Manual correction
Forgot to tap? Edit the date and times, give a reason, and the original values
are preserved in the audit log while the day is flagged as corrected.

### Holidays and leave
Mark your own holidays and approved leave. Those days stop being counted as
absences *and* stop inflating the scheduled-days total — no administrator
needed.

---

## How lateness is calculated

With an expected arrival of **09:00** and a **10-minute** grace period:

| Arrival | Verdict | After schedule | After grace |
|---|---|---|---|
| 08:45 | On time | 0 | 0 |
| 09:05 | On time | 5 | 0 |
| 09:10 | On time | 10 | 0 |
| 09:11 | **Late** | 11 | 1 |
| 09:30 | **Late** | 30 | 20 |

The grace boundary is inclusive — 09:10 exactly is still on time.

Reports show **minutes after the scheduled arrival** in the *Late By* column,
but only on days that actually breached the grace period; an arrival inside
grace reads `0m`. The beyond-grace figure is shown in the day detail, so both
numbers are always available and the policy is never ambiguous.

---

## Project layout

```
src/
  lib/            Pure logic — no React, no network. Where the rules live.
    tz.ts           Time zones, date keys, DST. Built on Intl, zero deps.
    attendance.ts   Day classification, lateness, live dashboard state.
    report.ts       Monthly aggregation and chart series.
    api.ts          Every Supabase call in the app.
    wifi.ts         The office-network probe.
    offline.ts      Pending-intent queue and reconciliation.
    export/         CSV, a hand-rolled XLSX writer, PDF.
  components/     UI, grouped by feature. ui/ holds the shadcn primitives.
  pages/          One file per route.
  providers/      Auth, the trusted clock, theme, connectivity, React Query.
supabase/
  migrations/     The schema, in four ordered files.
  tests/          Database behaviour suite.
scripts/
  office-verifier.mjs   The LAN endpoint to run at the office.
  db-test.sh            Runs the database suite in a throwaway container.
  generate-icons.mjs    Generates the PWA icons.
docs/
```

Everything in `src/lib/` is pure and directly tested. That is deliberate: the
rules that decide whether a day counts as absent should not be entangled with
rendering.

---

## Testing

```bash
npm run test       # 199 unit + component tests
npm run test:db    # 49 database assertions against real PostgreSQL (needs Docker)
npx tsc -b         # type check
npm run build      # production build
```

The database suite is not a mock. It stands up PostgreSQL in a container,
applies all four migrations, and asserts the behaviour that has to hold
regardless of what any client does:

- a second check-in while a session is open is rejected;
- a client-supplied 1999 timestamp does **not** become the record;
- a direct table `UPDATE` is audited, not just the RPC path;
- a deleted record's audit trail survives it;
- one user cannot see or write another user's rows.

Writing these caught three bugs that no amount of frontend testing would have:
a subquery in a CHECK constraint (which made the migrations fail to apply at
all), an audit insert that RLS would have refused on every single check-in, and
a foreign-key violation when deleting a record.

The chart palette is likewise verified rather than eyeballed — the colours in
`chart-theme.ts` were run through a colour-vision-deficiency validator in both
light and dark mode, which is why the status composition is a labelled list
rather than a six-hue chart.

---

## Edge cases that are handled

| Situation | Behaviour |
|---|---|
| Check In tapped twice | Second is refused; no duplicate row |
| Check Out tapped twice | Second is refused |
| Forgot to check out | Day shows *Missing Check-Out*; a stale open session is flagged on the dashboard |
| Forgot to check in | Day shows *Missing Check-In*; add it with a correction |
| No connection | The tap is refused with an explanation. Nothing is claimed to be saved. Optionally note the device time for later confirmation |
| Phone clock is wrong | Recorded time is unaffected; the drift is stored and surfaced |
| Browser refresh mid-session | State is derived from the server, not from memory |
| Month changes while checked in | Check-out closes the open session wherever it started |
| Check-in just before midnight | Business date resolved in the office zone; overnight mode keeps the shift on one record |
| Two devices at once | `FOR UPDATE` plus a unique constraint serialise them |
| Holiday on a working day | Excluded from absences *and* from scheduled days |
| Schedule changed mid-month | Past days keep their snapshotted policy |
| Future dates | Never classified as absent |
| DST transition | Wall-clock conversion resolves gaps forward and picks the earlier of an ambiguous pair |

---

## Security

- **Row Level Security on every table**, scoped to `auth.uid()`. The `anon`
  role is revoked from all of them.
- **The audit log is read-only to clients** — `INSERT`, `UPDATE` and `DELETE`
  are revoked, and entries are written by a `SECURITY DEFINER` trigger.
- **The RPCs are `SECURITY INVOKER`**, so RLS still applies inside them.
- **Rate limiting** on every write path, in the database.
- **Server-side validation** of times, dates, time zones and reasons, by CHECK
  constraint — not merely in the form.
- **Only the anon key ships to the browser**, and the app refuses to start if it
  is given a service-role key.

---

## Accessibility

Targets are at least 44 px. Status is always carried by an icon and a text
label, never colour alone — so the calendar, the badges and the PDF all read in
greyscale. Text meets WCAG AA in both themes. The calendar is arrow-key
navigable with a roving tab stop. Form errors are linked to their fields with
`aria-describedby` and take focus on submit. `prefers-reduced-motion` is
honoured, and pinch-zoom is never blocked.

---

## Licence

Private, personal use.

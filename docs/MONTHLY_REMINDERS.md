# Monthly reminders

## What the app does on its own

On your configured **reporting day** (default: the 5th), the dashboard shows a
prompt to review the previous month, and the Reports page opens on that month
by default. The logic is in `monthlyReviewState()` and is covered by tests:

- On 5 November, October's report is ready, and the reminder fires.
- Before the 5th, the month still awaiting review is September — because
  October has not unlocked yet.
- After the 5th, the prompt stays available but stops announcing itself.

**This only works while the app is open.** A web page that is not running
cannot execute code. That is not a limitation of this app; it is how browsers
work.

## What a web app genuinely cannot do

Be sceptical of any tool that claims a website will remind you when it is
closed. The honest picture:

| Mechanism | Reality |
|---|---|
| `setTimeout` / `setInterval` | Dies the moment the tab closes. |
| Service worker | Only wakes in response to an event — a fetch, a push, or a sync. It cannot schedule itself for a date a month away. |
| Periodic Background Sync | Chrome/Android only, requires the PWA to be installed *and* frequently engaged, and the browser decides the interval — it is explicitly not a scheduler. Absent on iOS entirely. |
| Web Push | Works, but needs a **server** to send the push. The server is what holds the schedule; the push is just the delivery. |
| Notification API alone | Can only display a notification while your code is already running. |

So: for a reminder that reaches you when the app is closed, something
server-side has to run on a schedule. Below are two ways to set that up, both
using infrastructure this project already has.

---

## Option A — Supabase scheduled job + email (recommended)

Supabase ships `pg_cron` and `pg_net`, so the database can send the reminder
itself with no extra service to host.

### 1. Enable the extensions

Dashboard → Database → Extensions → enable **pg_cron** and **pg_net**.

### 2. Store your email provider key as a secret

Use [Supabase Vault](https://supabase.com/docs/guides/database/vault) rather
than pasting a key into a migration:

```sql
select vault.create_secret('re_your_resend_api_key', 'resend_api_key');
```

### 3. Create the reminder function

```sql
create or replace function public.send_monthly_review_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_key text;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets where name = 'resend_api_key';

  for r in
    select p.user_id, p.office_name, p.timezone, u.email
    from public.profiles p
    join auth.users u on u.id = p.user_id
    where p.notify_monthly_review
      -- Compare in the user's own zone, so someone in Karachi is reminded on
      -- their 5th, not on UTC's.
      and extract(day from (now() at time zone p.timezone)) = p.reporting_day
  loop
    perform net.http_post(
      url     := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_build_object(
        'from',    'Attendance <attendance@your-domain.com>',
        'to',      r.email,
        'subject', 'Your ' || to_char(
                     (now() at time zone r.timezone) - interval '1 month', 'FMMonth YYYY'
                   ) || ' attendance is ready',
        'html',
          '<p>' || r.office_name || ' attendance for <strong>' ||
          to_char((now() at time zone r.timezone) - interval '1 month', 'FMMonth YYYY') ||
          '</strong> is ready to review.</p>' ||
          '<p><a href="https://your-app.vercel.app/reports">Open the report</a></p>'
      )
    );
  end loop;
end;
$$;

revoke all on function public.send_monthly_review_reminders() from public, anon, authenticated;
```

Note it is `SECURITY DEFINER` and revoked from every client role — only the
scheduler may call it.

### 4. Schedule it

```sql
select cron.schedule(
  'monthly-attendance-review',
  -- Hourly, because "the 5th at 09:00" differs per time zone; the function
  -- itself filters down to the right users.
  '0 * * * *',
  $$ select public.send_monthly_review_reminders() $$
);
```

To send at a specific local hour as well, add to the `where` clause:

```sql
and extract(hour from (now() at time zone p.timezone)) = 9
```

### 5. Verify

```sql
select * from cron.job;
select * from cron.job_run_details order by start_time desc limit 10;
```

Run it once by hand first:
`select public.send_monthly_review_reminders();`

---

## Option B — an external scheduler

If you would rather not put HTTP calls in the database:

- **GitHub Actions** — a workflow on `schedule: - cron: '0 4 5 * *'` calling a
  small script. Free, and the schedule lives in version control.
- **Vercel Cron** — add to `vercel.json`:

  ```json
  { "crons": [{ "path": "/api/monthly-reminder", "schedule": "0 4 5 * *" }] }
  ```

  then add `api/monthly-reminder.ts` as a serverless function. It must use the
  **service-role key**, which is safe there because it never reaches the
  browser — set it as a Vercel env var *without* a `VITE_` prefix.

- **Supabase Edge Function** on a cron trigger, if you prefer Deno to SQL.

Whichever you pick, the rule is the same: the schedule lives on a server, and
the key that lets it read every user's data never goes near the client bundle.

---

## Web Push, if you want a phone notification rather than an email

Push works on Android Chrome and on iOS 16.4+ **when the app has been added to
the Home Screen**. It needs:

1. VAPID keys, and a subscription stored per device;
2. a server-side job (either option above) that sends the push;
3. a `push` handler in the service worker.

`vite-plugin-pwa` is already generating the service worker, so adding a handler
is a small change — but you still need the server-side scheduler. Push is the
delivery mechanism, never the timer.

---

## In-app reminders you get for free

These need no infrastructure and already work:

- **Monthly review prompt** on the dashboard from your reporting day.
- **Missing check-out warning** — a session left open from an earlier day is
  called out on the dashboard and in the report's "Needs attention" list.
- **Wrong device clock warning** when the phone is more than a minute off the
  server.

Toggles for the first two are in **Settings → Reminders**.

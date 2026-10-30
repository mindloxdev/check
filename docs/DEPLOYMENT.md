# Setup and deployment

Two pieces: a Supabase project (database + auth) and a static frontend on
Vercel. Neither needs a server you maintain.

---

## 1. Supabase

### Create the project

1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Pick a region near your office — every check-in is one round trip, and the
   recorded timestamp comes from this database's clock.
3. Save the database password somewhere safe.

### Apply the migrations

**With the CLI (preferred — it tracks what has been applied):**

```bash
npm install -g supabase            # or use npx
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

**Or by hand:** open the SQL editor and paste each file from
`supabase/migrations/` **in filename order**:

| Order | File | What it does |
|---|---|---|
| 1 | `20261101000100_schema.sql` | Tables, enums, constraints, indexes |
| 2 | `20261101000200_functions.sql` | Server-side check-in / check-out RPCs |
| 3 | `20261101000300_audit.sql` | The audit trigger |
| 4 | `20261101000400_rls.sql` | Row Level Security and grants |

Order matters — later files reference objects created by earlier ones.

### Verify it took

```sql
-- Every table should report rowsecurity = true.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

-- The RPCs should all be present.
select proname from pg_proc
where pronamespace = 'public'::regnamespace
  and proname like 'attendance%' or proname in ('server_now', 'ensure_profile');
```

### Configure auth

**Authentication → Providers → Email**

- Enable email sign-in.
- Turn **Confirm email** on for production.
- Consider disabling new sign-ups once your own account exists — this is a
  personal app, and an open sign-up form is an invitation.

**Authentication → URL Configuration**

- Site URL: `https://your-app.vercel.app`
- Redirect URLs: add `https://your-app.vercel.app/reset-password`

Without that second entry the password-reset link will not work.

### Collect your keys

**Project Settings → API**

- Project URL → `VITE_SUPABASE_URL`
- `anon` / publishable key → `VITE_SUPABASE_ANON_KEY`

> The `service_role` key on that page bypasses Row Level Security completely.
> It must never be given a `VITE_` prefix and must never reach the browser.
> The app refuses to start if it detects one in the anon slot.

---

## 2. Local development

```bash
npm install
cp .env.example .env.local      # then fill in the two values
npm run dev                     # http://localhost:5173
```

Without the env vars the app renders a setup screen explaining what is missing,
rather than a blank page.

### Running everything locally

If you have Docker, the whole stack runs on your machine:

```bash
supabase start      # Postgres + Auth + PostgREST + Studio
supabase db reset   # applies every migration from scratch
```

`supabase start` prints a local URL and anon key — put those in `.env.local`.
Studio is at <http://localhost:54323>, and sign-up emails are captured at
<http://localhost:54324> instead of being sent.

### Checks

```bash
npm run test        # 199 unit and component tests
npm run test:db     # 49 database assertions in a throwaway Postgres
npx tsc -b          # type check
npm run build       # production build
```

`npm run test:db` needs only Docker, not the Supabase CLI: it stands up a plain
Postgres, applies a minimal `auth` schema shim, runs every migration, and
asserts the constraints, triggers and RLS policies.

---

## 3. Vercel

### Deploy

```bash
npm install -g vercel
vercel          # preview
vercel --prod   # production
```

Or import the repository from the Vercel dashboard. The settings are detected
from `vercel.json`:

| Setting | Value |
|---|---|
| Framework | Vite |
| Build command | `npm run build` |
| Output directory | `dist` |
| Install command | `npm install` |

### Environment variables

**Project Settings → Environment Variables** — add both for *Production*,
*Preview* and *Development*:

```
VITE_SUPABASE_URL        https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY   <anon key>
```

Vite inlines these at **build** time, so changing them requires a redeploy, not
just a restart.

### What `vercel.json` sets up

- **SPA rewrites**, so `/reports` reloads correctly instead of 404ing — with
  static assets and the service worker excluded from the rewrite.
- **Immutable caching** for hashed assets, and `must-revalidate` for `sw.js`
  so a new service worker is picked up promptly.
- **Security headers**: `X-Frame-Options: DENY`, `nosniff`,
  `strict-origin-when-cross-origin`, and a `Permissions-Policy` that turns off
  camera, microphone and geolocation — the app needs none of them.
- **`X-Robots-Tag: noindex`**, because a personal attendance record has no
  business in a search index.

### After the first deploy

1. Add the Vercel URL to Supabase's **Site URL** and **Redirect URLs**.
2. Open the app, sign up, and sign in.
3. Set your schedule in **Settings**.
4. On Android: Chrome menu → *Add to Home screen*. On iOS: Share → *Add to Home
   Screen*. Installed, it opens full-screen and the check-in button is one tap
   from the home screen.

---

## 4. Going live checklist

- [ ] All four migrations applied, in order
- [ ] `rowsecurity = true` on every table in `public`
- [ ] Email confirmation enabled
- [ ] Sign-ups disabled once your account exists
- [ ] Redirect URL added for `/reset-password`
- [ ] Only the anon key reached the bundle. Vite inlines `VITE_*` values at
      build time, so decode what actually shipped — the payload must say
      `"role":"anon"`:

      ```bash
      grep -ohE 'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+' dist/assets/*.js \
        | cut -d. -f2 | base64 -d 2>/dev/null
      ```

      (Grepping for the literal string `service_role` is not a useful check —
      `src/lib/supabase.ts` contains that word on purpose, in the guard that
      refuses to start if it is handed such a key.)
- [ ] Time zone set correctly in Settings (this drives every date boundary)
- [ ] Wi-Fi verification configured, or deliberately left off
- [ ] Monthly reminder scheduled if you want email — see
      [MONTHLY_REMINDERS.md](./MONTHLY_REMINDERS.md)
- [ ] A test check-in and check-out round trip on your phone

---

## 5. Backups

Supabase takes daily backups on paid plans. On the free plan, export manually:

```bash
supabase db dump --data-only -f backup-$(date +%F).sql
```

You can also export your own data at any time from **Reports → Export**, which
produces CSV, Excel and PDF. The CSV is plain text and will outlive any app.

---

## Troubleshooting

**Blank page after deploy** — the env vars are missing or were added after the
build. Check the browser console and redeploy.

**"Supabase is not configured"** — the same cause; this screen is the app
telling you clearly instead of failing silently.

**Check-in fails with a permission error** — the RLS migration has not been
applied, or was applied before the schema migration. Re-run them in order.

**Password reset link does nothing** — `/reset-password` is not in Supabase's
Redirect URLs.

**Times look wrong by several hours** — check **Settings → Office time zone**.
Recorded instants are always correct (they are UTC from the server clock); only
the rendering depends on this setting, so fixing it corrects history too.

**A day shows as absent that should not** — mark it as a holiday or as leave in
**Settings → Holidays and leave**, and it is excluded from both the absence
count and the scheduled-days total.

# Offline behaviour

## The rule

**An offline tap is never reported as a successful check-in.**

There is no trusted clock offline. The whole point of taking the timestamp from
the database is that the device's clock cannot be relied on — so writing the
device's time to local storage and calling it attendance would discard the
guarantee the app is built around.

So when there is no connection, the button says so, and says plainly that
nothing was recorded:

> **Offline — cannot record**
> Your attendance has **not** been recorded. There is no trusted clock offline,
> so nothing is written until the server confirms it.

## What you can do instead

Below that there is a secondary action:

> *Note the time on this device for later*

This stores a **pending intent** — not attendance. The entry records what the
device's clock said, which business date the device thought it was, and that it
is unconfirmed. Nothing is sent anywhere.

When the connection returns, the dashboard shows a card:

> **1 offline tap was not recorded**
> These were saved on this device only, using this device's clock. Confirm each
> one to write it as a manual correction with its origin noted in the audit log.

Confirming submits it through the ordinary `attendance_manual_upsert` path, so
the resulting record is:

- flagged `manual_correction = true`;
- carries a reason naming the device time and when it was confirmed, e.g.
  *"Check-in tapped offline at 09:05 on 2026-10-29 (device clock, unverified)
  and confirmed on reconnect."*;
- fully present in the audit log.

In other words, an offline tap becomes a **documented correction**, never a
timestamp masquerading as trusted.

## Why not just queue the write and replay it?

A background sync that replays the request later would record whatever time the
*server* saw at replay — which could be hours after you actually arrived. That
is worse than useless: it would be silently wrong rather than visibly
incomplete.

Sending the device's time as the authoritative value instead would mean
trusting a clock the app explicitly does not trust, and would open the door to
backdating attendance by changing the phone's date.

The pending-intent flow is the honest middle: the information is kept, it is
labelled as what it is, and a human confirms it.

## What is cached

The service worker (via `vite-plugin-pwa`) precaches the app shell — HTML, JS,
CSS, icons and fonts — so the app opens instantly and works offline well enough
to show you what it cannot do.

**Supabase API traffic is never cached.** A cached attendance response would be
far more dangerous than a failed one: it could show yesterday's check-in as
today's, or suggest a write succeeded when it did not. Every data request goes
to the network or fails.

## Connectivity detection

`navigator.onLine` alone is not enough: a phone attached to office Wi-Fi with no
internet route still reports `true`. So the app combines two signals:

1. the browser's `online` / `offline` events, and
2. actual request failures reported by the data layer.

Either one shows the offline banner. A successful request clears it, as does an
`online` event — which gives the connection the benefit of the doubt and lets
the next request decide, rather than leaving a stale banner up forever.

## If storage itself fails

In a private window, or with site data blocked, `localStorage` can throw. The
queue re-reads storage after writing and returns `null` if the entry did not
survive. The UI then says so:

> **Nothing could be saved**
> This device refused to store the reminder, so there is no record of the tap at
> all.

Which is, again, the honest answer rather than a reassuring one.

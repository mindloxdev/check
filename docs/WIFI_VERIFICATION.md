# Office Wi-Fi verification

## The short version

**A website cannot read your Wi-Fi network name.** Not on Android Chrome, not on
iOS Safari, not with any permission prompt. This app does not pretend otherwise.

What it does instead is check whether your phone can reach a small endpoint that
**only exists on your office network**, and whether that endpoint answers with
your secret token. If both are true, your phone has a route to the office LAN —
a strong, honest signal, recorded as exactly that.

---

## Why the obvious approaches do not work

| Approach | Why it fails |
|---|---|
| Read the SSID in JavaScript | No such web API exists. The Network Information API (`navigator.connection`) reports a coarse effective type like `4g`, is unavailable on iOS, and never reports a network *name*. |
| `navigator.connection.type === 'wifi'` | Not implemented in any shipping browser for this purpose, and even where a value appears it says nothing about *which* Wi-Fi. |
| Check the public IP address | Everyone behind the office NAT shares it — but so does anyone on a VPN into the office, on a colleague's hotspot through the same ISP, or at a branch office. It is an ISP-level hint, not a presence check. |
| Geolocation | Needs a permission prompt every time, drains battery, is accurate to tens of metres at best indoors, and is trivially spoofable from devtools. |
| Compare `performance.timing` to a known host | Latency varies with load and radio conditions; it produces false negatives constantly. |

## What this app actually does

```
  phone on office Wi-Fi                    office LAN
 ┌──────────────────────┐              ┌──────────────────────┐
 │  attendance web app  │  GET /verify │  office-verifier.mjs │
 │                      │ ───────────> │  on 192.168.1.50     │
 │  mode: 'cors'        │              │                      │
 │  cache: 'no-store'   │ <─────────── │  { "token": "a1b2…" }│
 │  4 s timeout         │   200 + CORS │                      │
 └──────────────────────┘              └──────────────────────┘
          │
          ├─ reachable + token matches  → verified
          ├─ reachable + wrong token    → failed   (some *other* server answered)
          ├─ unreachable / timed out    → failed   (not on the office network)
          └─ no endpoint configured     → not_configured
```

The result is stored on the attendance record as
`check_in_verification_status`, and the UI labels it plainly.

**A failed probe never discards attendance.** That is a hard rule: the record is
always written, marked unverified, and shown as such. Losing a day because a
Raspberry Pi was rebooting would be far worse than an unverified check-in.

### Why `mode: 'cors'` and not `no-cors`

A `no-cors` request succeeds *opaquely* for any reachable host — you cannot read
the status or the body, only that something answered. That would make the check
meaningless: a captive portal, a router admin page, or a printer would all
"pass". The probe therefore uses a real CORS request and requires a readable
body containing the token. The verifier script sends the necessary
`Access-Control-Allow-Origin` header.

### Why the token matters

Without a token, "something answered on 192.168.1.50:8787" is the whole test.
Plug in a different router at home with the same subnet and it might pass. The
token proves it is *your* endpoint.

---

## Setting it up

### 1. Pick a machine on the office network

Anything that is on whenever you are: a desktop, a Raspberry Pi, a NAS, a spare
laptop. It needs Node.js 20+ and a stable address.

### 2. Give it a fixed address

Either set a static IP, or reserve one for its MAC address in the router's DHCP
settings. If the address moves, the URL in the app stops working.

### 3. Generate a token

In the app: **Settings → Office Wi-Fi verification → the dice button** next to
*Expected token*. Copy the value.

### 4. Run the verifier on that machine

```bash
# from a clone of this repo, or just copy scripts/office-verifier.mjs across
OFFICE_VERIFY_TOKEN=paste-your-token-here node scripts/office-verifier.mjs
```

It prints every address it can be reached on:

```
Office attendance verifier is running.

Reachable at:
    http://192.168.1.50:8787/verify
```

Lock it down to your deployed app's origin once it works:

```bash
OFFICE_VERIFY_TOKEN=... ALLOWED_ORIGIN=https://attendance.example.com \
  node scripts/office-verifier.mjs
```

### 5. Configure the app

**Settings → Office Wi-Fi verification**

| Field | Value |
|---|---|
| Verification mode | `Check and record` to start with |
| Verification endpoint URL | `http://192.168.1.50:8787/verify` |
| Expected token | the token you generated |
| Probe timeout | `4000` ms is a good default |

Tap **Test now** while on the office Wi-Fi. You should see *Verified*. Then turn
mobile data on and Wi-Fi off and test again — it should fail. If it passes from
mobile data, your endpoint is reachable from the internet and proves nothing;
close that port at the router.

### 6. Keep it running

**Linux (systemd)** — `/etc/systemd/system/office-verifier.service`:

```ini
[Unit]
Description=Office attendance verifier
After=network-online.target

[Service]
Environment=OFFICE_VERIFY_TOKEN=your-token-here
Environment=PORT=8787
ExecStart=/usr/bin/node /opt/office-verifier/office-verifier.mjs
Restart=always
User=nobody

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now office-verifier
```

**Windows** — run it with [NSSM](https://nssm.cc/) or a Task Scheduler task set
to *Run whether user is logged on or not*, triggered *At startup*.

**macOS** — a `launchd` plist in `~/Library/LaunchAgents/` with
`RunAtLoad` and `KeepAlive` set to `true`.

---

## The HTTPS problem, and how to avoid it

Your app will be served over **https** on Vercel. Browsers block an https page
from fetching a plain **http** URL — mixed content.

There is an exception that makes this work in practice: under the [Private
Network Access](https://developer.chrome.com/blog/private-network-access-update)
rules, a request from a secure page to a **private IP address**
(`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`, `localhost`) is treated as
potentially trustworthy. The app's URL validator enforces exactly this: a plain
`http://` endpoint is accepted only for a private address, and warns otherwise.

So:

- `http://192.168.1.50:8787/verify` — **works** from an https app
- `http://office.example.com/verify` — **blocked**; use https or a private IP

If you need a hostname, give the verifier a real TLS certificate (a local CA
such as [mkcert](https://github.com/FiloSottile/mkcert), or a public certificate
for a name that resolves to the private address) and use `https://`.

Chrome may still show a one-time permission prompt for private network access on
some versions. Allow it.

---

## Threat model — what this does not prove

Be clear-eyed about it:

- **It does not prove physical presence.** Anyone with a VPN into the office
  network, or a forwarded port, would pass.
- **It does not prove the phone is the user's.** It proves the *network* is.
- **The token is visible to anyone on the LAN** who can reach the endpoint. It
  is a marker, not a credential.

For a personal attendance tracker — where you are the only user and you have no
incentive to defraud yourself — that is the right balance. The point is to catch
the honest mistake of checking in from home out of habit, not to defeat a
determined attacker.

If you need stronger assurance, the native-app path below is the route.

---

## Future: a native Android app

Android *can* read Wi-Fi information, subject to permissions. A thin native
wrapper could:

- request `ACCESS_FINE_LOCATION` (required since Android 8.1 for SSID access)
  and `ACCESS_WIFI_STATE`;
- read `WifiManager.getConnectionInfo().getSSID()` and `.getBSSID()`;
- match the **BSSID** — the access point's MAC address — rather than the SSID,
  since an SSID is trivially spoofed by naming a hotspot "OfficeWiFi" while a
  BSSID identifies the specific hardware;
- call the same `attendance_check_in` RPC with
  `p_verification => 'verified'`.

The database already models this: `verification_status` is an enum on the
record, not a boolean, and nothing in the schema or the RPCs assumes the probe
came from a browser. Adding a native client needs no migration.

Note that recent Android releases restrict SSID reads further when location
services are off, and that iOS offers no equivalent outside a managed-device
context — which is precisely why the browser path exists and is the default.

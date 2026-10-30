import * as React from 'react'
import { toast } from 'sonner'
import { Dices, Info, Radio, Save, ShieldCheck, ShieldX } from 'lucide-react'
import {
  WIFI_MODE_DESCRIPTION,
  WIFI_MODE_LABEL,
  probeOfficeNetwork,
  suggestToken,
  validateEndpointUrl,
  type WifiProbeResult,
} from '@/lib/wifi'
import { useUpdateProfile } from '@/hooks/use-attendance'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ProfileRow, WifiMode } from '@/types/database'
import { cn } from '@/lib/utils'

/**
 * Wi-Fi verification settings.
 *
 * The copy here is deliberately blunt about what the browser can do. Promising
 * SSID detection would be a lie, and a user who believed it would mis-trust
 * every "unverified" record. The honest mechanism — reachability of a host that
 * only exists on the office LAN — is explained inline and in
 * `docs/WIFI_VERIFICATION.md`.
 */
export function WifiSettings({ profile }: { profile: ProfileRow }) {
  const update = useUpdateProfile()

  const [mode, setMode] = React.useState<WifiMode>(profile.wifi_mode)
  const [endpoint, setEndpoint] = React.useState(profile.wifi_endpoint_url ?? '')
  const [token, setToken] = React.useState(profile.wifi_expected_token ?? '')
  const [timeout, setTimeoutMs] = React.useState(String(profile.wifi_timeout_ms))
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [probe, setProbe] = React.useState<WifiProbeResult | null>(null)
  const [testing, setTesting] = React.useState(false)

  React.useEffect(() => {
    setMode(profile.wifi_mode)
    setEndpoint(profile.wifi_endpoint_url ?? '')
    setToken(profile.wifi_expected_token ?? '')
    setTimeoutMs(String(profile.wifi_timeout_ms))
  }, [profile])

  const validate = (): Record<string, string> => {
    const found: Record<string, string> = {}
    const urlError = validateEndpointUrl(endpoint)
    if (urlError) found.endpoint = urlError

    if (mode !== 'off' && endpoint.trim() === '') {
      found.endpoint = 'Add the endpoint URL, or set verification to Off.'
    }

    const ms = Number(timeout)
    if (!Number.isInteger(ms) || ms < 500 || ms > 30000) {
      found.timeout = 'Use a timeout between 500 and 30000 ms.'
    }
    if (token.length > 256) found.token = 'Keep the token under 256 characters.'
    return found
  }

  const handleSave = (event: React.FormEvent) => {
    event.preventDefault()
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) {
      document.getElementById(`wifi-${Object.keys(found)[0]}`)?.focus()
      return
    }

    update.mutate(
      {
        wifi_mode: mode,
        wifi_endpoint_url: endpoint.trim() || null,
        wifi_expected_token: token.trim() || null,
        wifi_timeout_ms: Number(timeout),
      },
      { onSuccess: () => toast.success('Wi-Fi verification saved') },
    )
  }

  const runTest = async () => {
    const urlError = validateEndpointUrl(endpoint)
    if (urlError || endpoint.trim() === '') {
      setErrors({ endpoint: urlError ?? 'Add an endpoint URL to test.' })
      return
    }
    setTesting(true)
    setProbe(null)
    try {
      const result = await probeOfficeNetwork({
        // Force a probe even when the saved mode is 'off', so the test button
        // is useful while setting it up.
        mode: mode === 'off' ? 'optional' : mode,
        endpointUrl: endpoint.trim(),
        expectedToken: token.trim() || null,
        timeoutMs: Number(timeout) || 4000,
      })
      setProbe(result)
    } finally {
      setTesting(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-4" noValidate>
      <div className="flex items-start gap-2 rounded-lg border border-info/25 bg-info-soft px-3 py-2 text-info-soft-foreground">
        <Info className="mt-px size-4 shrink-0" aria-hidden="true" />
        <div className="space-y-1 text-xs leading-relaxed">
          <p>
            <strong className="font-semibold">A browser cannot read your Wi-Fi name.</strong>{' '}
            There is no web API for the SSID on Android Chrome or iOS Safari, and a public IP
            address does not prove where you are.
          </p>
          <p>
            Instead, the app checks whether it can reach a small endpoint that only exists on
            your office network, and whether that endpoint returns your secret token. Set it
            up with <code className="rounded bg-card/60 px-1">scripts/office-verifier.mjs</code>{' '}
            — see <code className="rounded bg-card/60 px-1">docs/WIFI_VERIFICATION.md</code>.
          </p>
        </div>
      </div>

      <Field
        label="Verification mode"
        htmlFor="wifi-mode"
        hint={WIFI_MODE_DESCRIPTION[mode]}
      >
        <Select value={mode} onValueChange={(value) => setMode(value as WifiMode)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['off', 'optional', 'required'] as WifiMode[]).map((value) => (
              <SelectItem key={value} value={value}>
                {WIFI_MODE_LABEL[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field
        label="Verification endpoint URL"
        htmlFor="wifi-endpoint"
        error={errors.endpoint}
        hint="A URL that only resolves on the office network, e.g. http://192.168.1.50:8787/verify"
      >
        <Input
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={endpoint}
          placeholder="http://192.168.1.50:8787/verify"
          invalid={Boolean(errors.endpoint)}
          onChange={(event) => setEndpoint(event.target.value)}
        />
      </Field>

      <Field
        label="Expected token"
        htmlFor="wifi-token"
        error={errors.token}
        hint="The endpoint must return this exact value. Without it, merely reaching any server at that address would count as verified."
      >
        <div className="flex gap-2">
          <Input
            autoComplete="off"
            spellCheck={false}
            value={token}
            placeholder="Paste the token from the office script"
            invalid={Boolean(errors.token)}
            onChange={(event) => setToken(event.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Generate a random token"
            title="Generate a random token"
            onClick={() => setToken(suggestToken())}
          >
            <Dices aria-hidden="true" />
          </Button>
        </div>
      </Field>

      <Field
        label="Probe timeout"
        htmlFor="wifi-timeout"
        error={errors.timeout}
        hint="How long to wait before giving up. A missing LAN host would otherwise hang the button for many seconds."
      >
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="numeric"
            min={500}
            max={30000}
            step={100}
            value={timeout}
            invalid={Boolean(errors.timeout)}
            onChange={(event) => setTimeoutMs(event.target.value)}
            className="w-28"
          />
          <span className="text-sm text-muted-foreground">ms</span>
        </div>
      </Field>

      {probe ? (
        <div
          role="status"
          className={cn(
            'flex items-start gap-2 rounded-lg border px-3 py-2',
            probe.status === 'verified'
              ? 'border-success/25 bg-success-soft text-success-soft-foreground'
              : 'border-caution/25 bg-caution-soft text-caution-soft-foreground',
          )}
        >
          {probe.status === 'verified' ? (
            <ShieldCheck className="mt-px size-4 shrink-0" aria-hidden="true" />
          ) : (
            <ShieldX className="mt-px size-4 shrink-0" aria-hidden="true" />
          )}
          <div className="space-y-0.5 text-xs leading-relaxed">
            <p className="font-semibold">
              {probe.status === 'verified' ? 'Verified' : 'Not verified'}
            </p>
            <p>{probe.message}</p>
            {probe.status !== 'verified' ? (
              <p className="opacity-90">
                Attendance is still recorded if this fails — it is simply marked unverified.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={update.isPending} loadingText="Saving…">
          <Save aria-hidden="true" />
          Save verification
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void runTest()}
          loading={testing}
          loadingText="Testing…"
        >
          <Radio aria-hidden="true" />
          Test now
        </Button>
      </div>
    </form>
  )
}

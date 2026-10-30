import * as React from 'react'
import { Building2, Mail, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { sendPasswordReset, signInWithPassword, signUpWithPassword } from '@/lib/api'
import { toAppError } from '@/lib/errors'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type Mode = 'signin' | 'signup' | 'reset'

/**
 * Sign-in.
 *
 * Password-manager friendly by construction: real `<input type="password">`
 * fields with the right `autoComplete` tokens, no paste blocking, and no
 * character-by-character splitting. Errors are summarised above the form *and*
 * shown inline, and the summary takes focus after a failed submit.
 */
export function LoginPage() {
  const [mode, setMode] = React.useState<Mode>('signin')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [formError, setFormError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const summaryRef = React.useRef<HTMLDivElement>(null)

  const validate = (): Record<string, string> => {
    const found: Record<string, string> = {}
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      found.email = 'Enter a valid email address.'
    }
    if (mode !== 'reset') {
      if (password.length < 8) {
        found.password = 'Use at least 8 characters.'
      } else if (mode === 'signup' && password.length > 72) {
        // bcrypt silently truncates beyond 72 bytes; say so rather than let a
        // long passphrase be quietly cut.
        found.password = 'Use 72 characters or fewer.'
      }
    }
    return found
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setFormError(null)
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) {
      document.getElementById(`auth-${Object.keys(found)[0]}`)?.focus()
      return
    }

    setBusy(true)
    try {
      if (mode === 'signin') {
        await signInWithPassword(email, password)
        // The auth provider picks the session up and the router redirects.
      } else if (mode === 'signup') {
        const result = await signUpWithPassword(email, password)
        if (result.session) {
          toast.success('Account created')
        } else {
          toast.success('Check your inbox', {
            description: 'Confirm your email address to finish signing up.',
          })
          setMode('signin')
        }
      } else {
        await sendPasswordReset(email)
        toast.success('Reset link sent', {
          description: 'Follow the link in the email to choose a new password.',
        })
        setMode('signin')
      }
    } catch (error) {
      const appError = toAppError(error)
      setFormError(
        appError.code === 'UNKNOWN' && /invalid login/i.test(appError.message)
          ? 'That email and password combination was not recognised.'
          : appError.message,
      )
      // Move focus to the summary so the failure is announced, not just drawn.
      requestAnimationFrame(() => summaryRef.current?.focus())
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-8">
      <div className="mb-6 flex flex-col items-center gap-3 text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-action">
          <Building2 className="size-6" aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-xl font-bold tracking-tight">Office Attendance</h1>
          <p className="text-[13px] text-muted-foreground">
            Your personal check-in record.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>
            {mode === 'signin'
              ? 'Sign in'
              : mode === 'signup'
                ? 'Create your account'
                : 'Reset your password'}
          </CardTitle>
          <CardDescription>
            {mode === 'reset'
              ? 'We will email you a link to choose a new password.'
              : 'Your attendance data is private to your account.'}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {mode !== 'reset' ? (
            <Tabs value={mode} onValueChange={(value) => {
              setMode(value as Mode)
              setErrors({})
              setFormError(null)
            }}>
              <TabsList>
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Sign up</TabsTrigger>
              </TabsList>
              <TabsContent value="signin" />
              <TabsContent value="signup" />
            </Tabs>
          ) : null}

          {formError ? (
            <div
              ref={summaryRef}
              tabIndex={-1}
              role="alert"
              className="rounded-lg border border-destructive/25 bg-destructive-soft px-3 py-2 text-[13px] font-medium text-destructive-soft-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {formError}
            </div>
          ) : null}

          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label="Email" htmlFor="auth-email" error={errors.email} required>
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                invalid={Boolean(errors.email)}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>

            {mode !== 'reset' ? (
              <Field
                label="Password"
                htmlFor="auth-password"
                error={errors.password}
                required
                hint={mode === 'signup' ? 'At least 8 characters.' : undefined}
              >
                <Input
                  type="password"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  value={password}
                  invalid={Boolean(errors.password)}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
            ) : null}

            <Button type="submit" block size="lg" loading={busy} loadingText="Please wait…">
              {mode === 'signin' ? (
                <>
                  <ShieldCheck aria-hidden="true" />
                  Sign in
                </>
              ) : mode === 'signup' ? (
                'Create account'
              ) : (
                <>
                  <Mail aria-hidden="true" />
                  Send reset link
                </>
              )}
            </Button>
          </form>

          <div className="flex justify-center">
            {mode === 'reset' ? (
              <Button variant="link" size="sm" onClick={() => setMode('signin')}>
                Back to sign in
              </Button>
            ) : (
              <Button variant="link" size="sm" onClick={() => setMode('reset')}>
                Forgot your password?
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <p className="mt-5 text-center text-[11px] leading-relaxed text-muted-foreground">
        Attendance timestamps always come from the server clock, so a wrong phone clock can
        never affect your record.
      </p>
    </main>
  )
}

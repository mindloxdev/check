import * as React from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { updatePassword } from '@/lib/api'
import { toAppError } from '@/lib/errors'
import { useAuth } from '@/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'

/**
 * Lands here from the recovery email.
 *
 * Supabase exchanges the link for a session before this renders
 * (`detectSessionInUrl`), so the page can simply call `updateUser`. If there is
 * no session the link has expired, and we say that rather than showing a form
 * that cannot work.
 */
export function ResetPasswordPage() {
  const navigate = useNavigate()
  const { session, isLoading } = useAuth()
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const found: Record<string, string> = {}
    if (password.length < 8) found.password = 'Use at least 8 characters.'
    else if (password.length > 72) found.password = 'Use 72 characters or fewer.'
    if (password !== confirm) found.confirm = 'The two passwords do not match.'
    setErrors(found)
    if (Object.keys(found).length > 0) {
      document.getElementById(`reset-${Object.keys(found)[0]}`)?.focus()
      return
    }

    setBusy(true)
    try {
      await updatePassword(password)
      toast.success('Password updated')
      navigate('/', { replace: true })
    } catch (error) {
      const appError = toAppError(error)
      setErrors({ password: appError.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-primary" aria-hidden="true" />
            Choose a new password
          </CardTitle>
          <CardDescription>
            {isLoading
              ? 'Checking your reset link…'
              : session
                ? 'Enter a new password for your account.'
                : 'This reset link has expired or has already been used.'}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {!isLoading && !session ? (
            <Button block onClick={() => navigate('/', { replace: true })}>
              Back to sign in
            </Button>
          ) : (
            <form onSubmit={submit} className="space-y-4" noValidate>
              <Field
                label="New password"
                htmlFor="reset-password"
                error={errors.password}
                required
                hint="At least 8 characters."
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  invalid={Boolean(errors.password)}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>

              <Field
                label="Confirm new password"
                htmlFor="reset-confirm"
                error={errors.confirm}
                required
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  invalid={Boolean(errors.confirm)}
                  onChange={(event) => setConfirm(event.target.value)}
                />
              </Field>

              <Button type="submit" block size="lg" loading={busy} loadingText="Updating…">
                Update password
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

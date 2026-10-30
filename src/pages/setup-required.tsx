import { Database, ExternalLink } from 'lucide-react'
import { supabaseConfigError } from '@/lib/supabase'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Shown when the Supabase environment variables are missing.
 *
 * A blank white screen with a console error is the worst possible outcome of a
 * misconfigured deploy, so the app renders actionable setup instructions
 * instead of crashing.
 */
export function SetupRequiredPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-5 text-primary" aria-hidden="true" />
            Finish connecting Supabase
          </CardTitle>
          <CardDescription>
            {supabaseConfigError?.message ??
              'The Supabase environment variables are not set.'}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 text-[13px] leading-relaxed">
          <ol className="list-decimal space-y-3 pl-5">
            <li>
              Create a project at{' '}
              <a
                href="https://supabase.com/dashboard"
                target="_blank"
                rel="noreferrer noopener"
                className="font-semibold text-primary hover:underline"
              >
                supabase.com/dashboard
                <ExternalLink className="ml-0.5 inline size-3" aria-hidden="true" />
              </a>
              .
            </li>
            <li>
              Apply the migrations in <Code>supabase/migrations</Code> with{' '}
              <Code>npx supabase db push</Code>, or paste them into the SQL editor in
              filename order.
            </li>
            <li>
              Copy <Code>.env.example</Code> to <Code>.env.local</Code> and fill in:
              <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 text-[12px]">
                <code>
                  {'VITE_SUPABASE_URL=https://<project-ref>.supabase.co\n'}
                  {'VITE_SUPABASE_ANON_KEY=<your anon / publishable key>'}
                </code>
              </pre>
            </li>
            <li>Restart the dev server, or redeploy if this is a hosted build.</li>
          </ol>

          <div className="rounded-lg border border-destructive/25 bg-destructive-soft px-3 py-2 text-destructive-soft-foreground">
            <p className="text-xs leading-relaxed">
              <strong className="font-semibold">Use the anon key, never the service-role
              key.</strong>{' '}
              The service-role key bypasses Row Level Security; in a browser bundle it would
              expose every row to anyone who opens devtools.
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            Full instructions are in <Code>README.md</Code>.
          </p>
        </CardContent>
      </Card>
    </main>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">{children}</code>
  )
}

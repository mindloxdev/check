import * as React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { toAppError } from '@/lib/errors'

/**
 * React Query configuration.
 *
 * `retry` deliberately does not retry an application-level rejection: tapping
 * Check In when already checked in must fail once and say so, not three times.
 * Only network-shaped failures are retried, and never a mutation — a retried
 * write could double-record attendance.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Attendance data changes when the user acts, and those actions
        // invalidate explicitly, so background refetching can be gentle.
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: (failureCount, error) => {
          if (failureCount >= 2) return false
          return toAppError(error).code === 'OFFLINE'
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
      },
      mutations: {
        // Never automatically retry a write.
        retry: false,
      },
    },
  })
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(createQueryClient)
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

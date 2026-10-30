import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { ThemeProvider } from './providers/theme-provider'
import { AuthProvider } from './providers/auth-provider'
import { ClockProvider } from './providers/clock-provider'
import { OnlineProvider } from './providers/online-provider'
import { QueryProvider } from './providers/query-provider'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element in index.html')

createRoot(container).render(
  <StrictMode>
    {/* Provider order matters: the clock needs auth (to resample on sign-in)
        and the query client; theme is independent and sits outermost so the
        setup screen is themed too. */}
    <ThemeProvider>
      <QueryProvider>
        <AuthProvider>
          <OnlineProvider>
            <ClockProvider>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </ClockProvider>
          </OnlineProvider>
        </AuthProvider>
      </QueryProvider>
    </ThemeProvider>
  </StrictMode>,
)

import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './styles/tokens.css'
import './styles/base.css'
import './styles/chrome.css'
import './styles/board.css'
import './styles/detail.css'

import * as Tooltip from '@radix-ui/react-tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App.tsx'
import { i18nReady } from './i18n'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, refetchOnWindowFocus: false, staleTime: 1000 },
  },
})

// The first render waits for the visitor's language (a small chunk), so no text changes under them.
void i18nReady.then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <MotionConfig reducedMotion="user">
            {/* Hints open after a short rest, then at once while moving between triggers; they
                close when the pointer leaves the trigger, so none sits over what it points at. */}
            <Tooltip.Provider delayDuration={400} skipDelayDuration={300} disableHoverableContent>
              <App />
            </Tooltip.Provider>
          </MotionConfig>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  ),
)

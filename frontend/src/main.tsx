import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import './styles/globals.css'
import './styles/tokens.css'
import './styles/parts.css'
import './styles/shell.css'
import './styles/docs.css'
import './styles/skin.css'
import { applyCachedSeeds } from './lib/brandTheme'
import { usePublicConfig } from './store/publicConfig'

applyCachedSeeds()
void usePublicConfig.getState().load()

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)

import { useState, useEffect } from 'react'
import LandingPage from './LandingPage'
import DocsPage from './DocsPage'
import FundsPage from './FundsPage'

function routeFor(hash: string): 'landing' | 'docs' | 'funds' {
  if (hash.startsWith('#docs')) return 'docs'
  if (hash.startsWith('#funds')) return 'funds'
  return 'landing'
}

export default function App() {
  const [page, setPage] = useState(() => routeFor(window.location.hash))

  useEffect(() => {
    const handler = () => setPage(routeFor(window.location.hash))
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  if (page === 'docs') return <DocsPage />
  if (page === 'funds') return <FundsPage />
  return <LandingPage />
}

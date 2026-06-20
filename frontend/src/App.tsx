import { useState, useEffect } from 'react'
import LandingPage from './LandingPage'
import DocsPage from './DocsPage'

export default function App() {
  const [page, setPage] = useState(() =>
    window.location.hash === '#docs' ? 'docs' : 'landing'
  )

  useEffect(() => {
    const handler = () =>
      setPage(window.location.hash === '#docs' ? 'docs' : 'landing')
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  return page === 'docs' ? <DocsPage /> : <LandingPage />
}

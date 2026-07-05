import Header from './components/Header'
import EndpointGroup from './components/EndpointGroup'
import { useOpenApi } from './hooks/useOpenApi'

export default function DocsPage() {
  const { spec, groups, loading, error } = useOpenApi()

  return (
    <div className="min-h-screen bg-slate-950">
      <Header />

      <main className="mx-auto max-w-5xl px-6 py-8">
        {loading && (
          <p className="text-sm text-slate-500">Loading API spec…</p>
        )}

        {error && (
          <div className="rounded-lg border border-red-900 bg-red-950/50 p-4 text-sm text-red-300">
            <p className="font-medium">Couldn't load the API spec.</p>
            <p className="mt-1">{error}</p>
            <p className="mt-2 text-red-400">
              Is the API running? In dev, start it with{' '}
              <code className="font-mono">npm run dev</code> in the{' '}
              <code className="font-mono">api/</code> folder.
            </p>
          </div>
        )}

        {!loading && !error && (
          <>
            {spec?.info.description && (
              <p className="mb-6 text-sm text-slate-400">{spec.info.description}</p>
            )}
            {groups.map((g) => (
              <EndpointGroup key={g.tag} tag={g.tag} description={g.description} endpoints={g.endpoints} />
            ))}
          </>
        )}
      </main>

      <footer className="border-t border-slate-800/80 py-6 text-center text-xs text-slate-500">
        Market Data API · data from AMFI · Apache 2.0 · not investment advice
      </footer>
    </div>
  )
}

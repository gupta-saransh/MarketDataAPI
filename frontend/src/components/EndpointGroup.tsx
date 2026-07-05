import type { Endpoint } from '../types'
import EndpointCard from './EndpointCard'

export default function EndpointGroup({
  tag, description, endpoints,
}: {
  tag: string
  description?: string
  endpoints: Endpoint[]
}) {
  return (
    <section className="mb-8">
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-white">{tag}</h2>
        {description && <p className="text-sm text-slate-500">{description}</p>}
      </div>
      <div className="space-y-2">
        {endpoints.map((e) => (
          <EndpointCard key={`${e.method}-${e.path}`} endpoint={e} />
        ))}
      </div>
    </section>
  )
}

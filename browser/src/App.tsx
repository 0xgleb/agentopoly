import { For, Show, createResource, onCleanup, onMount } from 'solid-js'

import * as Effect from 'effect/Effect'

import type { BrowserProjection, BrowserProjectionResult } from '../projection.ts'

const MAX_JAVASCRIPT_DATE_MILLISECONDS = 8_640_000_000_000_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isBoundedText = (value: unknown, maximumLength: number): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  new TextEncoder().encode(value).byteLength <= maximumLength

const isFreshness = (value: unknown): value is 'current' | 'stale' =>
  value === 'current' || value === 'stale'

const isVerification = (value: unknown): value is 'failed' | 'passed' | 'unobserved' =>
  value === 'failed' || value === 'passed' || value === 'unobserved'

const isPaymentReason = (
  value: unknown,
): value is 'missing-exact-payment-authorization' | 'verification-failed' =>
  value === 'missing-exact-payment-authorization' || value === 'verification-failed'

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1

const isValidDateMilliseconds = (value: unknown): value is number =>
  isPositiveSafeInteger(value) && value <= MAX_JAVASCRIPT_DATE_MILLISECONDS

const isEventType = (
  value: unknown,
): value is
  | 'payment.refused'
  | 'provider.artifact-submitted'
  | 'provider.started'
  | 'reputation.updated'
  | 'settlement.refusal-recorded'
  | 'verification.completed' =>
  value === 'payment.refused' ||
  value === 'provider.artifact-submitted' ||
  value === 'provider.started' ||
  value === 'reputation.updated' ||
  value === 'settlement.refusal-recorded' ||
  value === 'verification.completed'

const decodeProjection = (value: unknown): BrowserProjectionResult | undefined => {
  if (!isRecord(value) || (value['_tag'] !== 'projection' && value['_tag'] !== 'refused')) {
    return undefined
  }
  if (value['_tag'] === 'refused' && typeof value['reason'] === 'string') {
    return { _tag: 'refused', reason: 'malformed-event-log' }
  }
  if (
    !Array.isArray(value['agents']) ||
    !Array.isArray(value['capabilities']) ||
    !Array.isArray(value['events']) ||
    !Array.isArray(value['jobs']) ||
    !Array.isArray(value['receipts']) ||
    !Array.isArray(value['terms']) ||
    !Array.isArray(value['unobserved'])
  ) {
    return undefined
  }

  const agents: BrowserProjection['agents'][number][] = value['agents'].flatMap((agent) =>
    isRecord(agent) &&
    typeof agent['profile'] === 'string' &&
    agent['role'] === 'provider' &&
    agent['source'] === 'live-agent-run'
      ? [
          {
            profile: agent['profile'],
            role: 'provider' as const,
            source: 'live-agent-run' as const,
          },
        ]
      : [],
  )
  const capabilities: BrowserProjection['capabilities'][number][] = value['capabilities'].flatMap(
    (capability) =>
      isRecord(capability) &&
      isBoundedText(capability['capabilityId'], 1_024) &&
      isBoundedText(capability['evidenceSummary'], 1_024) &&
      isBoundedText(capability['inputContract'], 1_024) &&
      isBoundedText(capability['limits'], 1_024) &&
      isBoundedText(capability['outputContract'], 1_024) &&
      isBoundedText(capability['priceBasis'], 1_024) &&
      isBoundedText(capability['providerIdentity'], 256) &&
      isValidDateMilliseconds(capability['expiresAt']) &&
      isPositiveSafeInteger(capability['revision'])
        ? [
            {
              capabilityId: capability['capabilityId'],
              evidenceSummary: capability['evidenceSummary'],
              expiresAt: capability['expiresAt'],
              inputContract: capability['inputContract'],
              limits: capability['limits'],
              outputContract: capability['outputContract'],
              priceBasis: capability['priceBasis'],
              providerIdentity: capability['providerIdentity'],
              revision: capability['revision'],
            },
          ]
        : [],
  )
  const events: BrowserProjection['events'][number][] = value['events'].flatMap((event) =>
    isRecord(event) &&
    typeof event['jobId'] === 'string' &&
    typeof event['recordedAt'] === 'string' &&
    isFreshness(event['freshness']) &&
    isEventType(event['type'])
      ? [
          {
            freshness: event['freshness'],
            jobId: event['jobId'],
            recordedAt: event['recordedAt'],
            type: event['type'],
          },
        ]
      : [],
  )
  const jobs: BrowserProjection['jobs'][number][] = value['jobs'].flatMap((job) => {
    if (
      !isRecord(job) ||
      typeof job['jobId'] !== 'string' ||
      typeof job['workspace'] !== 'string' ||
      !isVerification(job['verification']) ||
      !isRecord(job['payment'])
    ) {
      return []
    }

    const payment = job['payment']
    const projectedPayment =
      payment['_tag'] === 'not-recorded'
        ? { _tag: 'not-recorded' as const }
        : payment['_tag'] === 'refused' &&
            isPaymentReason(payment['reason']) &&
            payment['wdkInvoked'] === false
          ? { _tag: 'refused' as const, reason: payment['reason'], wdkInvoked: false as const }
          : undefined
    if (projectedPayment === undefined) return []

    return [
      {
        ...(typeof job['artifactHash'] === 'string' ? { artifactHash: job['artifactHash'] } : {}),
        jobId: job['jobId'],
        payment: projectedPayment,
        ...(typeof job['providerProfile'] === 'string'
          ? { providerProfile: job['providerProfile'] }
          : {}),
        verification: job['verification'],
        workspace: job['workspace'],
      },
    ]
  })

  const receipts: BrowserProjection['receipts'][number][] = value['receipts'].flatMap((receipt) =>
    isRecord(receipt) &&
    isBoundedText(receipt['atomicAmount'], 78) &&
    /^[1-9][0-9]*$/.test(receipt['atomicAmount']) &&
    isBoundedText(receipt['jobId'], 128) &&
    isBoundedText(receipt['network'], 128)
      ? [
          {
            atomicAmount: receipt['atomicAmount'],
            jobId: receipt['jobId'],
            network: receipt['network'],
          },
        ]
      : [],
  )
  const terms: BrowserProjection['terms'][number][] = value['terms'].flatMap((term) =>
    isRecord(term) &&
    isBoundedText(term['atomicAmount'], 78) &&
    /^[1-9][0-9]*$/.test(term['atomicAmount']) &&
    isValidDateMilliseconds(term['executionDeadline']) &&
    isBoundedText(term['jobId'], 1_024) &&
    isBoundedText(term['network'], 128) &&
    isBoundedText(term['provider'], 256) &&
    isBoundedText(term['serviceId'], 1_024)
      ? [
          {
            atomicAmount: term['atomicAmount'],
            executionDeadline: term['executionDeadline'],
            jobId: term['jobId'],
            network: term['network'],
            provider: term['provider'],
            serviceId: term['serviceId'],
          },
        ]
      : [],
  )

  if (
    agents.length !== value['agents'].length ||
    capabilities.length !== value['capabilities'].length ||
    events.length !== value['events'].length ||
    jobs.length !== value['jobs'].length ||
    receipts.length !== value['receipts'].length ||
    terms.length !== value['terms'].length ||
    (capabilities.length === 0 &&
      (value['unobserved'].length !== 3 ||
        value['unobserved'][0] !== 'capability discovery' ||
        value['unobserved'][1] !== 'signed terms' ||
        value['unobserved'][2] !== 'arbitration')) ||
    (capabilities.length > 0 &&
      (value['unobserved'].length !== 2 ||
        value['unobserved'][0] !== 'signed terms' ||
        value['unobserved'][1] !== 'arbitration'))
  ) {
    return undefined
  }

  return {
    _tag: 'projection',
    agents,
    capabilities,
    events,
    jobs,
    receipts,
    terms,
    unobserved:
      capabilities.length === 0
        ? ['capability discovery', 'signed terms', 'arbitration']
        : ['signed terms', 'arbitration'],
  }
}

const fetchProjection = (): Promise<BrowserProjectionResult> =>
  Effect.runPromise(
    Effect.match(
      Effect.tryPromise({
        try: async () => {
          const response = await fetch('/api/projection')
          if (!response.ok) throw new Error('projection request failed')
          return response.json()
        },
        catch: () => 'projection-unavailable',
      }),
      {
        onFailure: () => ({ _tag: 'refused', reason: 'malformed-event-log' }) as const,
        onSuccess: (value) =>
          decodeProjection(value) ?? { _tag: 'refused', reason: 'malformed-event-log' },
      },
    ),
  )

export const App = () => {
  const [projection, { refetch }] = createResource(fetchProjection)

  onMount(() => {
    const interval = window.setInterval(() => void refetch(), 2_000)
    onCleanup(() => window.clearInterval(interval))
  })

  return (
    <main class="dashboard">
      <header class="dashboard__header">
        <p class="eyebrow">Agentopoly / local browser projection</p>
        <h1>Observed agent economy</h1>
        <button type="button" onClick={() => void refetch()}>
          Refresh evidence
        </button>
      </header>
      <Show when={projection.loading}>
        <p role="status">Refreshing the bounded local projection…</p>
      </Show>
      <Show when={projection()} keyed>
        {(result) => (
          <Show
            when={result._tag === 'projection' ? result : undefined}
            fallback={
              <p role="alert">
                Projection refused:{' '}
                {result._tag === 'refused' ? result.reason : 'projection unavailable'}
              </p>
            }
          >
            {(snapshot) => (
              <section class="dashboard__grid" aria-label="Agentopoly economy projection">
                <article>
                  <h2>Observed providers</h2>
                  <Show
                    when={snapshot().agents.length > 0}
                    fallback={<p>No provider runtime has been observed.</p>}
                  >
                    <ul>
                      <For each={snapshot().agents}>
                        {(agent) => <li>{agent.profile} · provider runtime profile</li>}
                      </For>
                    </ul>
                  </Show>
                </article>
                <article>
                  <h2>Observed capabilities</h2>
                  <Show
                    when={snapshot().capabilities.length > 0}
                    fallback={<p>No live peer capability has been observed.</p>}
                  >
                    <ul>
                      <For each={snapshot().capabilities}>
                        {(capability) => (
                          <li>
                            <strong>{capability.providerIdentity}</strong> ·{' '}
                            {capability.capabilityId}
                            <br />
                            {capability.priceBasis} · {capability.limits}
                            <br />
                            Expires{' '}
                            <time dateTime={new Date(capability.expiresAt).toISOString()}>
                              {new Date(capability.expiresAt).toISOString()}
                            </time>
                            <br />
                            {capability.evidenceSummary}
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </article>
                <article>
                  <h2>Recorded payment receipts</h2>
                  <Show
                    when={snapshot().receipts.length > 0}
                    fallback={<p>No complete payment receipt has been observed.</p>}
                  >
                    <ul>
                      <For each={snapshot().receipts}>
                        {(receipt) => (
                          <li>
                            <strong>{receipt.jobId}</strong> · {receipt.atomicAmount} atomic USDt ·{' '}
                            {receipt.network}
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </article>
                <article>
                  <h2>Validated terms</h2>
                  <Show
                    when={snapshot().terms.length > 0}
                    fallback={<p>No validated agreement has been observed.</p>}
                  >
                    <ul>
                      <For each={snapshot().terms}>
                        {(term) => (
                          <li>
                            <strong>{term.jobId}</strong> · {term.provider} · {term.serviceId}
                            <br />
                            {term.atomicAmount} atomic USDt · {term.network}
                            <br />
                            Deadline{' '}
                            <time dateTime={new Date(term.executionDeadline).toISOString()}>
                              {new Date(term.executionDeadline).toISOString()}
                            </time>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </article>
                <article>
                  <h2>Recorded jobs</h2>
                  <Show
                    when={snapshot().jobs.length > 0}
                    fallback={<p>No job evidence has been recorded.</p>}
                  >
                    <For each={snapshot().jobs}>
                      {(job) => (
                        <section class="job" aria-label={`Job ${job.jobId}`}>
                          <h3>{job.jobId}</h3>
                          <p>Provider: {job.providerProfile ?? 'not observed'}</p>
                          <p>Verification: {job.verification}</p>
                          <p>
                            Settlement:{' '}
                            {job.payment._tag === 'refused'
                              ? `refused (${job.payment.reason}); WDK invoked: ${job.payment.wdkInvoked}`
                              : 'not recorded'}
                          </p>
                          <Show when={job.artifactHash}>{(hash) => <code>{hash()}</code>}</Show>
                        </section>
                      )}
                    </For>
                  </Show>
                </article>
                <article>
                  <h2>Evidence timeline</h2>
                  <ol>
                    <For each={snapshot().events}>
                      {(event) => (
                        <li>
                          <time dateTime={event.recordedAt}>{event.recordedAt}</time> · {event.type}{' '}
                          · {event.freshness}
                        </li>
                      )}
                    </For>
                  </ol>
                  <p>Not observed in this runtime: {snapshot().unobserved.join(', ')}.</p>
                </article>
              </section>
            )}
          </Show>
        )}
      </Show>
    </main>
  )
}

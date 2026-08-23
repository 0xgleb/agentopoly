import { describe, expect, test } from 'bun:test'

import { projectEventLog } from '../../browser/projection.ts'

const artifactHash = 'a'.repeat(64)
const recordedAt = '2026-08-21T12:00:00.000Z'
const expiresAt = new Date('2026-08-21T12:10:00.000Z').getTime()

const eventLog = (events: readonly Readonly<Record<string, unknown>>[]): string =>
  events.map((event) => JSON.stringify(event)).join('\n')

const liveEvent = (
  type: string,
  fields: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => ({
  evidenceSource: 'live-agent-run',
  recordedAt,
  schemaVersion: 1,
  type,
  ...fields,
})

const capabilityObserved = (
  fields: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> => ({
  capabilityId: 'normalize-market-handle',
  envelopeKeyRevision: 1,
  envelopeMessageId: 'capability-message-a',
  envelopePayloadHash: 'b'.repeat(64),
  envelopeSenderIdentity: 'provider-alpha',
  evidenceHash: 'c'.repeat(64),
  evidenceSource: 'live-peer',
  evidenceSummary: 'signed advertisement admitted by the local capability market',
  expiresAt,
  inputContract: 'utf8 handle',
  limits: 'one normalized handle per request',
  outputContract: 'normalized lowercase handle',
  priceBasis: 'quoted per request',
  providerIdentity: 'provider-alpha',
  recordedAt,
  revision: 1,
  schemaVersion: 1,
  type: 'capability.observed',
  withdrawal: false,
  ...fields,
})

describe('browser economy projection', () => {
  test('projects only recorded provider, verification, and typed settlement-refusal evidence', () => {
    const projection = projectEventLog(
      eventLog([
        liveEvent('provider.started', {
          jobId: 'normalize-market-handle-v1',
          profile: 'reliable-provider',
          workspace: '.tmp/agentopoly-runs/run-1',
        }),
        liveEvent('provider.artifact-submitted', {
          artifactHash,
          jobId: 'normalize-market-handle-v1',
          profile: 'reliable-provider',
          workspace: '.tmp/agentopoly-runs/run-1',
        }),
        liveEvent('verification.completed', {
          artifactHash,
          jobId: 'normalize-market-handle-v1',
          passed: true,
          workspace: '.tmp/agentopoly-runs/run-1',
        }),
        liveEvent('payment.refused', {
          artifactHash,
          jobId: 'normalize-market-handle-v1',
          reason: 'missing-exact-payment-authorization',
          wdkInvoked: false,
          workspace: '.tmp/agentopoly-runs/run-1',
        }),
      ]),
      new Date(recordedAt),
    )

    expect(projection._tag).toBe('projection')
    if (projection._tag === 'projection') {
      expect(projection.agents).toEqual([
        {
          profile: 'reliable-provider',
          role: 'provider',
          source: 'live-agent-run',
        },
      ])
      expect(projection.jobs).toEqual([
        expect.objectContaining({
          artifactHash,
          jobId: 'normalize-market-handle-v1',
          payment: {
            _tag: 'refused',
            reason: 'missing-exact-payment-authorization',
            wdkInvoked: false,
          },
          providerProfile: 'reliable-provider',
          verification: 'passed',
        }),
      ])
      expect(projection.unobserved).toEqual(['capability discovery', 'signed terms', 'arbitration'])
    }
  })

  test('refuses malformed, oversized, and future event input without projecting a job', () => {
    const malformed = projectEventLog('{not json', new Date(recordedAt))
    const oversized = projectEventLog('x'.repeat(1_048_577), new Date(recordedAt))
    const future = projectEventLog(
      eventLog([
        liveEvent('provider.started', {
          jobId: 'normalize-market-handle-v1',
          profile: 'reliable-provider',
          recordedAt: '2026-08-21T12:00:31.000Z',
          workspace: '.tmp/agentopoly-runs/run-1',
        }),
      ]),
      new Date(recordedAt),
    )

    expect(malformed).toMatchObject({ _tag: 'refused', reason: 'malformed-event-log' })
    expect(oversized).toMatchObject({ _tag: 'refused', reason: 'event-log-too-large' })
    expect(future).toMatchObject({ _tag: 'refused', reason: 'future-event' })
  })

  test('deduplicates exact recorded events, orders out-of-order evidence, and marks stale evidence', () => {
    const earlier = liveEvent('provider.started', {
      jobId: 'normalize-market-handle-v1',
      profile: 'reliable-provider',
      recordedAt: '2026-08-21T11:50:00.000Z',
      workspace: '.tmp/agentopoly-runs/run-1',
    })
    const later = liveEvent('provider.artifact-submitted', {
      artifactHash,
      jobId: 'normalize-market-handle-v1',
      profile: 'reliable-provider',
      recordedAt,
      workspace: '.tmp/agentopoly-runs/run-1',
    })

    const projection = projectEventLog(
      eventLog([later, earlier, earlier]),
      new Date('2026-08-21T12:10:01.000Z'),
    )

    expect(projection._tag).toBe('projection')
    if (projection._tag === 'projection') {
      expect(projection.events).toHaveLength(2)
      expect(projection.events[0]?.type).toBe('provider.started')
      expect(projection.events[0]?.freshness).toBe('stale')
      expect(projection.events[1]?.type).toBe('provider.artifact-submitted')
    }
  })

  test('projects validated fixed-price terms without exposing witness secrets or authority', () => {
    const projection = projectEventLog(
      eventLog([
        liveEvent('agreement.observed', {
          atomicAmount: '1250000',
          executionDeadline: 1_787_400_800_000,
          jobId: 'normalize-market-handle-v1',
          network: 'ethereum-sepolia',
          provider: 'provider-alpha',
          serviceId: 'normalize-market-handle',
          termsHash: 'd'.repeat(64),
          workspace: '.tmp/agentopoly-runs/run-1',
        }),
      ]),
      new Date(recordedAt),
    )

    expect(projection._tag).toBe('projection')
    if (projection._tag === 'projection') {
      expect(projection.terms).toEqual([
        {
          atomicAmount: '1250000',
          executionDeadline: 1_787_400_800_000,
          jobId: 'normalize-market-handle-v1',
          network: 'ethereum-sepolia',
          provider: 'provider-alpha',
          serviceId: 'normalize-market-handle',
        },
      ])
      expect(projection.jobs).toEqual([])
    }
  })

  test('projects a bounded locally admitted capability without creating a job or authority', () => {
    const projection = projectEventLog(eventLog([capabilityObserved()]), new Date(recordedAt))

    expect(projection).toEqual({
      _tag: 'projection',
      agents: [],
      capabilities: [
        {
          capabilityId: 'normalize-market-handle',
          evidenceSummary: 'signed advertisement admitted by the local capability market',
          expiresAt,
          inputContract: 'utf8 handle',
          limits: 'one normalized handle per request',
          outputContract: 'normalized lowercase handle',
          priceBasis: 'quoted per request',
          providerIdentity: 'provider-alpha',
          revision: 1,
        },
      ],
      events: [],
      jobs: [],
      terms: [],
      unobserved: ['signed terms', 'arbitration'],
    })
  })

  test('refuses partial, forged, or expired capability observations and deduplicates exact evidence', () => {
    const partial = projectEventLog(
      eventLog([capabilityObserved({ evidenceHash: undefined })]),
      new Date(recordedAt),
    )
    const forged = projectEventLog(
      eventLog([capabilityObserved({ evidenceSource: 'live-agent-run' })]),
      new Date(recordedAt),
    )
    const directAdvertisement = projectEventLog(
      eventLog([capabilityObserved({ type: 'capability.advertise' })]),
      new Date(recordedAt),
    )
    const expired = projectEventLog(
      eventLog([capabilityObserved({ expiresAt: new Date(recordedAt).getTime() })]),
      new Date(recordedAt),
    )
    const invalidDate = projectEventLog(
      eventLog([capabilityObserved({ expiresAt: Number.MAX_SAFE_INTEGER })]),
      new Date(recordedAt),
    )
    const staleRevision = projectEventLog(
      eventLog([capabilityObserved({ revision: 2 }), capabilityObserved({ revision: 1 })]),
      new Date(recordedAt),
    )
    const deduplicated = projectEventLog(
      eventLog([capabilityObserved(), capabilityObserved()]),
      new Date(recordedAt),
    )

    expect(partial).toEqual({ _tag: 'refused', reason: 'malformed-event-log' })
    expect(forged).toEqual({ _tag: 'refused', reason: 'malformed-event-log' })
    expect(directAdvertisement).toEqual({ _tag: 'refused', reason: 'malformed-event-log' })
    expect(expired).toEqual({ _tag: 'refused', reason: 'malformed-event-log' })
    expect(invalidDate).toEqual({ _tag: 'refused', reason: 'malformed-event-log' })
    expect(staleRevision).toEqual({ _tag: 'refused', reason: 'malformed-event-log' })
    expect(deduplicated._tag).toBe('projection')
    if (deduplicated._tag === 'projection') {
      expect(deduplicated.capabilities).toHaveLength(1)
      expect(deduplicated.unobserved).toContain('signed terms')
      expect(deduplicated.unobserved).not.toContain('capability discovery')
    }
  })

  test('ignores a bounded legacy receipt without deriving settlement or reputation', () => {
    const projection = projectEventLog(
      eventLog([
        liveEvent('receipt.recorded', {
          arbitraryLegacyReceiptField: 'must not reach the projection',
          jobId: 'normalize-market-handle-v1',
          settlementState: 'settled',
          workspace: '.tmp/agentopoly-runs/run-1',
        }),
        liveEvent('payment.refused', {
          artifactHash,
          jobId: 'normalize-market-handle-v1',
          reason: 'missing-exact-payment-authorization',
          wdkInvoked: false,
          workspace: '.tmp/agentopoly-runs/run-1',
        }),
      ]),
      new Date(recordedAt),
    )

    expect(projection._tag).toBe('projection')
    if (projection._tag === 'projection') {
      expect(projection.events).toEqual([expect.objectContaining({ type: 'payment.refused' })])
      expect(projection.jobs).toHaveLength(1)
      expect(projection.jobs[0]?.payment).toEqual({
        _tag: 'refused',
        reason: 'missing-exact-payment-authorization',
        wdkInvoked: false,
      })
    }
  })

  test('does not create a projection from legacy receipt fields alone', () => {
    const projection = projectEventLog(
      eventLog([
        liveEvent('receipt.recorded', {
          artifactHash,
          jobId: 'legacy-receipt-job',
          profile: 'forged-provider',
          settlementState: 'settled',
          workspace: '.tmp/agentopoly-runs/run-legacy',
        }),
      ]),
      new Date(recordedAt),
    )

    expect(projection).toEqual({
      _tag: 'projection',
      agents: [],
      capabilities: [],
      events: [],
      jobs: [],
      terms: [],
      unobserved: ['capability discovery', 'signed terms', 'arbitration'],
    })
  })

  test('refuses a legacy receipt without the bounded common envelope', () => {
    const projection = projectEventLog(
      eventLog([
        {
          evidenceSource: 'live-agent-run',
          jobId: 'normalize-market-handle-v1',
          recordedAt,
          schemaVersion: 1,
          type: 'receipt.recorded',
        },
      ]),
      new Date(recordedAt),
    )

    expect(projection).toEqual({ _tag: 'refused', reason: 'malformed-event-log' })
  })
})

import { describe, expect, test } from 'bun:test'

import * as Effect from 'effect/Effect'

import { decodeLatestVerification, deriveSettlementEvents } from '../../cli/settlement.ts'

const workspace = '.tmp/agentopoly-runs/reliable'

describe('live settlement decision events', () => {
  test('refuses WDK payment without exact authorization while preserving positive service evidence', async () => {
    const verification = await Effect.runPromise(
      decodeLatestVerification(
        `${JSON.stringify({
          artifactHash: 'a'.repeat(64),
          evidenceSource: 'live-agent-run',
          jobId: 'normalize-market-handle-v1',
          passed: true,
          recordedAt: '2026-08-22T23:00:00.000Z',
          evidenceHash: 'd'.repeat(64),
          schemaVersion: 1,
          termsHash: 'c'.repeat(64),
          type: 'verification.completed',
          verifierHash: 'e'.repeat(64),
          workspace,
        })}\n`,
        workspace,
      ),
    )

    expect(deriveSettlementEvents(verification)).toEqual([
      {
        artifactHash: 'a'.repeat(64),
        evidenceSource: 'live-agent-run',
        jobId: 'normalize-market-handle-v1',
        reason: 'missing-exact-payment-authorization',
        termsHash: 'c'.repeat(64),
        type: 'payment.refused',
        wdkInvoked: false,
        workspace,
      },
      {
        artifactHash: 'a'.repeat(64),
        evidenceSource: 'live-agent-run',
        jobId: 'normalize-market-handle-v1',
        paymentStatus: 'refused',
        termsHash: 'c'.repeat(64),
        type: 'receipt.recorded',
        verificationStatus: 'passed',
        workspace,
      },
      {
        delta: 1,
        evidenceSource: 'live-agent-run',
        jobId: 'normalize-market-handle-v1',
        reason: 'verified-delivery',
        termsHash: 'c'.repeat(64),
        type: 'reputation.updated',
        workspace,
      },
    ])
  })

  test('failed verification refuses provider payment and records negative evidence', async () => {
    const verification = await Effect.runPromise(
      decodeLatestVerification(
        `${JSON.stringify({
          artifactHash: 'b'.repeat(64),
          evidenceSource: 'live-agent-run',
          jobId: 'normalize-market-handle-v1',
          passed: false,
          recordedAt: '2026-08-22T23:00:00.000Z',
          evidenceHash: 'd'.repeat(64),
          schemaVersion: 1,
          termsHash: 'c'.repeat(64),
          type: 'verification.completed',
          verifierHash: 'e'.repeat(64),
          workspace,
        })}\n`,
        workspace,
      ),
    )
    const events = deriveSettlementEvents(verification)

    expect(events[0]).toMatchObject({
      reason: 'verification-failed',
      type: 'payment.refused',
      wdkInvoked: false,
    })
    expect(events[2]).toMatchObject({
      delta: -1,
      reason: 'failed-verification',
      type: 'reputation.updated',
    })
  })

  test('fails closed when one workspace has conflicting verification bindings', async () => {
    const event = (termsHash: string) =>
      JSON.stringify({
        artifactHash: 'a'.repeat(64),
        evidenceHash: 'd'.repeat(64),
        evidenceSource: 'live-agent-run',
        jobId: 'normalize-market-handle-v1',
        passed: true,
        recordedAt: '2026-08-22T23:00:00.000Z',
        schemaVersion: 1,
        termsHash,
        type: 'verification.completed',
        verifierHash: 'e'.repeat(64),
        workspace,
      })
    const result = await Effect.runPromiseExit(
      decodeLatestVerification(`${event('c'.repeat(64))}\n${event('f'.repeat(64))}\n`, workspace),
    )

    expect(result._tag).toBe('Failure')
  })

  test('refuses a verification event without all payment-binding hashes', async () => {
    const unbound = await Effect.runPromiseExit(
      decodeLatestVerification(
        `${JSON.stringify({
          artifactHash: 'a'.repeat(64),
          evidenceSource: 'live-agent-run',
          jobId: 'normalize-market-handle-v1',
          passed: true,
          recordedAt: '2026-08-22T23:00:00.000Z',
          schemaVersion: 1,
          type: 'verification.completed',
          workspace,
        })}\n`,
        workspace,
      ),
    )

    expect(unbound._tag).toBe('Failure')
  })

  test('fails closed on malformed or missing verification evidence', async () => {
    const malformed = await Effect.runPromiseExit(
      decodeLatestVerification('{"schemaVersion":1,"type":"verification.completed"}\n', workspace),
    )
    const missing = await Effect.runPromiseExit(
      decodeLatestVerification(
        `${JSON.stringify({ schemaVersion: 1, type: 'provider.started' })}\n`,
        workspace,
      ),
    )

    expect(malformed._tag).toBe('Failure')
    expect(missing._tag).toBe('Failure')
  })
})

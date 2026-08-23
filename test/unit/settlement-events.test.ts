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
          schemaVersion: 1,
          type: 'verification.completed',
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
        type: 'payment.refused',
        wdkInvoked: false,
        workspace,
      },
      {
        artifactHash: 'a'.repeat(64),
        evidenceSource: 'live-agent-run',
        jobId: 'normalize-market-handle-v1',
        paymentStatus: 'refused',
        type: 'receipt.recorded',
        verificationStatus: 'passed',
        workspace,
      },
      {
        delta: 1,
        evidenceSource: 'live-agent-run',
        jobId: 'normalize-market-handle-v1',
        reason: 'verified-delivery',
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
          schemaVersion: 1,
          type: 'verification.completed',
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

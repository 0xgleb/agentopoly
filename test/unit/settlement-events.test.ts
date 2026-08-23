import { describe, expect, test } from 'bun:test'

import * as Effect from 'effect/Effect'

import {
  decodeLatestVerification,
  deriveSettlementEvents,
  selectSettlementEventsToAppend,
} from '../../cli/settlement.ts'

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
        type: 'settlement.refusal-recorded',
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
    expect(events[1]).toMatchObject({
      paymentStatus: 'refused',
      type: 'settlement.refusal-recorded',
      verificationStatus: 'failed',
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

  test('selects the latest verification for the requested workspace only', async () => {
    const event = (overrides: Readonly<Record<string, unknown>>): string =>
      JSON.stringify({
        artifactHash: 'c'.repeat(64),
        evidenceHash: 'd'.repeat(64),
        evidenceSource: 'live-agent-run',
        jobId: 'normalize-market-handle-v1',
        passed: true,
        recordedAt: '2026-08-22T23:00:00.000Z',
        schemaVersion: 1,
        termsHash: 'e'.repeat(64),
        type: 'verification.completed',
        verifierHash: 'f'.repeat(64),
        workspace,
        ...overrides,
      })
    const result = await Effect.runPromise(
      decodeLatestVerification(
        [
          '{',
          event({}),
          event({
            passed: false,
            workspace: '.tmp/agentopoly-runs/other',
          }),
          event({}),
        ].join('\n'),
        workspace,
      ),
    )
    expect(result).toMatchObject({
      artifactHash: 'c'.repeat(64),
      jobId: 'normalize-market-handle-v1',
      passed: true,
      termsHash: 'e'.repeat(64),
      workspace,
    })
  })

  test('does not append duplicate refusal or reputation evidence on repeated finalization', async () => {
    const verification = {
      artifactHash: 'a'.repeat(64),
      evidenceHash: 'd'.repeat(64),
      jobId: 'normalize-market-handle-v1',
      passed: true,
      termsHash: 'c'.repeat(64),
      verifierHash: 'e'.repeat(64),
      workspace,
    } as const
    const recorded = deriveSettlementEvents(verification)
      .map((event) =>
        JSON.stringify({
          ...event,
          recordedAt: '2026-08-22T23:00:00.000Z',
          schemaVersion: 1,
        }),
      )
      .join('\n')

    const selected = await Effect.runPromise(
      selectSettlementEventsToAppend(`${recorded}\n`, verification),
    )

    expect(selected).toEqual([])
  })

  test('resumes a partially recorded refusal without repeating completed events', async () => {
    const verification = {
      artifactHash: 'a'.repeat(64),
      evidenceHash: 'd'.repeat(64),
      jobId: 'normalize-market-handle-v1',
      passed: true,
      termsHash: 'c'.repeat(64),
      verifierHash: 'e'.repeat(64),
      workspace,
    } as const
    const [paymentRefused, refusalRecorded, reputationUpdated] =
      deriveSettlementEvents(verification)
    const recorded = `${JSON.stringify({
      ...paymentRefused,
      recordedAt: '2026-08-22T23:00:00.000Z',
      schemaVersion: 1,
    })}\n`

    const selected = await Effect.runPromise(selectSettlementEventsToAppend(recorded, verification))

    expect(selected).toEqual([refusalRecorded, reputationUpdated])
  })

  test('fails closed on conflicting refusal evidence for the same workspace and job', async () => {
    const verification = {
      artifactHash: 'a'.repeat(64),
      evidenceHash: 'd'.repeat(64),
      jobId: 'normalize-market-handle-v1',
      passed: true,
      termsHash: 'c'.repeat(64),
      verifierHash: 'e'.repeat(64),
      workspace,
    } as const
    const conflict = JSON.stringify({
      artifactHash: 'b'.repeat(64),
      evidenceSource: 'live-agent-run',
      jobId: verification.jobId,
      reason: 'missing-exact-payment-authorization',
      recordedAt: '2026-08-22T23:00:00.000Z',
      schemaVersion: 1,
      termsHash: verification.termsHash,
      type: 'payment.refused',
      wdkInvoked: false,
      workspace,
    })

    const reputationConflict = JSON.stringify({
      delta: -1,
      evidenceSource: 'live-agent-run',
      jobId: verification.jobId,
      reason: 'failed-verification',
      recordedAt: '2026-08-22T23:00:00.000Z',
      schemaVersion: 1,
      termsHash: verification.termsHash,
      type: 'reputation.updated',
      workspace,
    })
    const [paymentResult, reputationResult] = await Promise.all([
      Effect.runPromiseExit(selectSettlementEventsToAppend(`${conflict}\n`, verification)),
      Effect.runPromiseExit(
        selectSettlementEventsToAppend(`${reputationConflict}\n`, verification),
      ),
    ])

    expect(paymentResult._tag).toBe('Failure')
    expect(reputationResult._tag).toBe('Failure')
  })

  test('fails closed on malformed matching or missing verification evidence', async () => {
    const malformed = await Effect.runPromiseExit(
      decodeLatestVerification(
        `${JSON.stringify({
          schemaVersion: 1,
          type: 'verification.completed',
          workspace,
        })}\n`,
        workspace,
      ),
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

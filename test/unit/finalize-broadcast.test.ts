import { describe, expect, test } from 'bun:test'
import * as Effect from 'effect/Effect'

import { createPaymentReservations } from '../../cli/payment-reservation.ts'
import { createPreviewRegistry } from '../../cli/wdk-preview-registry.ts'
import {
  finalizeAuthorizedBroadcast,
  type ReservationPersistence,
} from '../../cli/finalize-broadcast.ts'
import type { WdkGateway } from '../../cli/wdk-gateway.ts'

const authorization = {
  artifactHash: 'a'.repeat(64),
  asset: 'USDt' as const,
  atomicAmount: '1500000',
  destination: '0xprovider',
  maximumNativeFee: '25000',
  network: 'ethereum-sepolia',
  sourceAccountIndex: 0,
  sourceAddress: '0xbuyer',
  sourceWallet: 'agentopoly-demo',
  termsHash: 'b'.repeat(64),
  token: 'usdt' as const,
  verificationHash: 'd'.repeat(64),
}

const makeFixture = (response: unknown, available = true, transportFailure = false) => {
  const calls: unknown[] = []
  const snapshots: unknown[] = []
  const gateway: WdkGateway = {
    available,
    invoke: (command) => {
      calls.push(command)
      return transportFailure
        ? Effect.fail({ _tag: 'gateway-failed' as const, reason: 'transport closed' })
        : Effect.succeed(response)
    },
  }
  const persistence: ReservationPersistence = {
    save: (snapshot) =>
      Effect.sync(() => {
        snapshots.push(snapshot)
      }),
  }
  const previews = createPreviewRegistry()
  const preview = previews.record(
    {
      atomicAmount: authorization.atomicAmount,
      destination: authorization.destination,
      network: authorization.network,
      termsHash: authorization.termsHash,
      verificationHash: authorization.verificationHash,
    },
    '42',
    2_000,
  )
  return {
    calls,
    gateway,
    persistence,
    preview,
    previews,
    reservations: createPaymentReservations(),
    snapshots,
  }
}

const run = (fixture: ReturnType<typeof makeFixture>, now = 1_000) =>
  Effect.runPromise(
    Effect.either(
      finalizeAuthorizedBroadcast({
        attemptId: 'attempt-1',
        authorization,
        gateway: fixture.gateway,
        now,
        persistence: fixture.persistence,
        preview: fixture.preview,
        previews: fixture.previews,
        reservations: fixture.reservations,
        sourceConfig: { sourceAccountIndex: 0, sourceWallet: 'agentopoly-demo' },
      }),
    ),
  )

describe('finalize authorized WDK broadcast', () => {
  test('persists an attempt-correlated success and returns a full receipt', async () => {
    const transactionHash = 'c'.repeat(64)
    const fixture = makeFixture({
      content: [
        {
          text: JSON.stringify({
            amount: authorization.atomicAmount,
            network: authorization.network,
            success: true,
            to: authorization.destination,
            txHash: transactionHash,
          }),
          type: 'text',
        },
      ],
    })

    const result = await run(fixture)

    expect(result._tag).toBe('Right')
    if (result._tag === 'Right') {
      expect(result.right.attemptId).toBe('attempt-1')
      expect(result.right.transactionHash).toBe(transactionHash)
    }
    expect(fixture.calls).toHaveLength(1)
    expect(fixture.snapshots).toHaveLength(3)
    const [attempt] = fixture.reservations.all()
    expect(fixture.reservations.all()).toHaveLength(1)
    expect(attempt?.attemptId).toBe('attempt-1')
    expect(attempt?.authorizationKey).toMatch(/^[a-f0-9]{64}$/)
    expect(attempt?.status).toBe('broadcasted')
    if (attempt?.status === 'broadcasted') {
      expect(attempt.transactionHash).toBe(transactionHash)
    }
  })

  test('persists reconciliation pending for malformed output and never retries it', async () => {
    const fixture = makeFixture({ content: [] })

    const first = await run(fixture)
    const second = await run(fixture)

    expect(first).toMatchObject({ _tag: 'Left', left: { _tag: 'reconciliation-pending' } })
    expect(second).toMatchObject({ _tag: 'Left', left: { _tag: 'reconciliation-pending' } })
    expect(fixture.calls).toHaveLength(1)
    const [attempt] = fixture.reservations.all()
    expect(fixture.reservations.all()).toHaveLength(1)
    expect(attempt?.attemptId).toBe('attempt-1')
    expect(attempt?.authorizationKey).toMatch(/^[a-f0-9]{64}$/)
    expect(attempt?.status).toBe('reconciliation-pending')
  })

  test('persists reconciliation pending after a transport failure', async () => {
    const fixture = makeFixture({}, true, true)

    const result = await run(fixture)

    expect(result).toMatchObject({ _tag: 'Left', left: { _tag: 'reconciliation-pending' } })
    expect(fixture.calls).toHaveLength(1)
    const [attempt] = fixture.reservations.all()
    expect(fixture.reservations.all()).toHaveLength(1)
    expect(attempt?.attemptId).toBe('attempt-1')
    expect(attempt?.authorizationKey).toMatch(/^[a-f0-9]{64}$/)
    expect(attempt?.status).toBe('reconciliation-pending')
  })

  test('makes zero gateway calls when the reservation marker cannot persist', async () => {
    const fixture = makeFixture({})
    const persistence: ReservationPersistence = {
      save: () =>
        Effect.fail({
          _tag: 'reservation-persistence-failed',
          reason: 'disk unavailable',
        }),
    }

    const result = await Effect.runPromise(
      Effect.either(
        finalizeAuthorizedBroadcast({
          attemptId: 'attempt-1',
          authorization,
          gateway: fixture.gateway,
          now: 1_000,
          persistence,
          preview: fixture.preview,
          previews: fixture.previews,
          reservations: fixture.reservations,
          sourceConfig: { sourceAccountIndex: 0, sourceWallet: 'agentopoly-demo' },
        }),
      ),
    )

    expect(result).toMatchObject({
      _tag: 'Left',
      left: { _tag: 'reservation-persistence-failed' },
    })
    expect(fixture.calls).toHaveLength(0)
  })

  test('makes zero gateway calls for stale, mismatched, duplicate, or unavailable inputs', async () => {
    const stale = makeFixture({})
    const mismatch = makeFixture({})
    const malformed = makeFixture({})
    const duplicate = makeFixture({})
    const unavailable = makeFixture({}, false)

    const staleResult = await run(stale, 2_000)
    const mismatchResult = await Effect.runPromise(
      Effect.either(
        finalizeAuthorizedBroadcast({
          attemptId: 'attempt-1',
          authorization,
          gateway: mismatch.gateway,
          now: 1_000,
          persistence: mismatch.persistence,
          preview: mismatch.preview,
          previews: mismatch.previews,
          reservations: mismatch.reservations,
          sourceConfig: { sourceAccountIndex: 1, sourceWallet: 'agentopoly-demo' },
        }),
      ),
    )
    const malformedResult = await Effect.runPromise(
      Effect.either(
        finalizeAuthorizedBroadcast({
          attemptId: 'attempt-1',
          authorization: { ...authorization, sourceWallet: '' },
          gateway: malformed.gateway,
          now: 1_000,
          persistence: malformed.persistence,
          preview: malformed.preview,
          previews: malformed.previews,
          reservations: malformed.reservations,
          sourceConfig: { sourceAccountIndex: 0, sourceWallet: '' },
        }),
      ),
    )
    await run(duplicate)
    const duplicateResult = await run(duplicate)
    const unavailableResult = await run(unavailable)

    expect(staleResult._tag).toBe('Left')
    expect(mismatchResult._tag).toBe('Left')
    expect(malformedResult._tag).toBe('Left')
    expect(duplicateResult._tag).toBe('Left')
    expect(unavailableResult).toMatchObject({ _tag: 'Left', left: { _tag: 'gateway-unavailable' } })
    expect(stale.calls).toHaveLength(0)
    expect(mismatch.calls).toHaveLength(0)
    expect(malformed.calls).toHaveLength(0)
    expect(malformed.reservations.all()).toEqual([])
    expect(duplicate.calls).toHaveLength(1)
    expect(unavailable.calls).toHaveLength(0)
  })
})

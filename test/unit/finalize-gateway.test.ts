import { describe, expect, test } from 'bun:test'
import * as Effect from 'effect/Effect'

import {
  derivePaymentReceiptEvent,
  selectPaymentReceiptToAppend,
  unavailableFinalizeGateway,
  validatePaymentReceiptForAuthorization,
} from '../../cli/finalize-gateway.ts'
import { derivePaymentAuthorizationKey } from '../../cli/finalize-broadcast.ts'

const receipt = {
  artifactHash: 'a'.repeat(64),
  atomicAmount: '1500000',
  attemptId: 'attempt-1',
  authorizationKey: 'b'.repeat(64),
  destination: '0xprovider',
  network: 'ethereum-sepolia',
  termsHash: 'c'.repeat(64),
  transactionHash: 'd'.repeat(64),
  verificationHash: 'e'.repeat(64),
}

const authorization = {
  artifactHash: receipt.artifactHash,
  asset: 'USDt' as const,
  atomicAmount: receipt.atomicAmount,
  destination: receipt.destination,
  maximumNativeFee: '25000',
  network: receipt.network,
  sourceAccountIndex: 0,
  sourceAddress: '0xbuyer',
  sourceWallet: 'agentopoly-demo',
  termsHash: receipt.termsHash,
  token: 'usdt' as const,
  verificationHash: receipt.verificationHash,
}

describe('finalize gateway', () => {
  test('revalidates an injected receipt against the exact authorization', async () => {
    const exact = {
      ...receipt,
      authorizationKey: derivePaymentAuthorizationKey(authorization),
    }
    const accepted = await Effect.runPromise(
      validatePaymentReceiptForAuthorization(exact, authorization),
    )
    const mismatched = await Effect.runPromise(
      Effect.either(
        validatePaymentReceiptForAuthorization(
          { ...exact, atomicAmount: '1500001' },
          authorization,
        ),
      ),
    )

    expect(accepted).toEqual(exact)
    expect(mismatched).toMatchObject({ left: { _tag: 'invalid-broadcast-witness' } })
    expect(derivePaymentAuthorizationKey(authorization)).not.toBe(
      derivePaymentAuthorizationKey({ ...authorization, maximumNativeFee: '25001' }),
    )
  })

  test('defaults to typed unavailable without starting a gateway', async () => {
    const result = await Effect.runPromise(
      Effect.either(
        unavailableFinalizeGateway.settle({
          ...receipt,
          asset: 'USDt',
          maximumNativeFee: '25000',
          sourceAccountIndex: 0,
          sourceAddress: '0xbuyer',
          sourceWallet: 'agentopoly-demo',
          token: 'usdt',
        }),
      ),
    )

    expect(result).toMatchObject({ left: { _tag: 'gateway-unavailable' } })
  })

  test('appends one strict receipt and refuses a conflicting replay', async () => {
    const event = derivePaymentReceiptEvent(
      receipt,
      'normalize-market-handle-v1',
      '.tmp/agentopoly-runs/reliable',
    )
    const empty = await Effect.runPromise(selectPaymentReceiptToAppend('', event))
    const recorded = JSON.stringify({
      ...event,
      recordedAt: '2026-08-23T00:00:00.000Z',
      schemaVersion: 2,
    })
    const duplicate = await Effect.runPromise(selectPaymentReceiptToAppend(recorded, event))
    const malformedUnrelated = await Effect.runPromise(
      selectPaymentReceiptToAppend(`not-json\n${recorded}`, event),
    )
    const legacy = await Effect.runPromise(
      selectPaymentReceiptToAppend(
        JSON.stringify({
          jobId: event.jobId,
          recordedAt: '2026-08-23T00:00:00.000Z',
          schemaVersion: 1,
          type: event.type,
          workspace: event.workspace,
        }),
        event,
      ),
    )
    const conflicting = await Effect.runPromise(
      Effect.either(
        selectPaymentReceiptToAppend(
          JSON.stringify({
            ...event,
            recordedAt: '2026-08-23T00:00:00.000Z',
            schemaVersion: 2,
            transactionHash: 'f'.repeat(64),
          }),
          event,
        ),
      ),
    )
    const unknownField = await Effect.runPromise(
      Effect.either(
        selectPaymentReceiptToAppend(
          JSON.stringify({
            ...event,
            recordedAt: '2026-08-23T00:00:00.000Z',
            schemaVersion: 2,
            unexpected: true,
          }),
          event,
        ),
      ),
    )

    expect(empty).toEqual([event])
    expect(duplicate).toEqual([])
    expect(malformedUnrelated).toEqual([])
    expect(legacy).toEqual([event])
    expect(conflicting).toMatchObject({ left: { _tag: 'invalid-broadcast-witness' } })
    expect(unknownField).toMatchObject({ left: { _tag: 'invalid-broadcast-witness' } })
  })
})

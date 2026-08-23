import { describe, expect, test } from 'bun:test'

import * as Either from 'effect/Either'
import * as Effect from 'effect/Effect'

import { decodeFinalizePolicy } from '../../cli/finalize-policy.ts'

const validPolicy = {
  maximumAtomicAmount: '1500000',
  maximumNativeFee: '25000',
  observedSourceAddress: '0xbuyer',
  remainingAtomicAmount: '1500000',
  sourceAccountIndex: 0,
  sourceAddress: '0xbuyer',
  sourceWallet: 'agentopoly-demo',
}

describe('local finalize policy', () => {
  test('decodes only a complete bounded local WDK policy', async () => {
    const decoded = await Effect.runPromise(decodeFinalizePolicy(JSON.stringify(validPolicy)))
    expect(decoded).toEqual(validPolicy)
  })

  test('refuses missing, replay-shaped, or unknown policy values', async () => {
    for (const value of [
      undefined,
      '{not json',
      JSON.stringify({ ...validPolicy, maximumAtomicAmount: '0' }),
      JSON.stringify({ ...validPolicy, sourceAccountIndex: -1 }),
      JSON.stringify({ ...validPolicy, unexpected: true }),
    ]) {
      const result = await Effect.runPromise(Effect.either(decodeFinalizePolicy(value)))
      expect(Either.isLeft(result)).toBe(true)
      if (Either.isLeft(result)) expect(result.left._tag).toBe('invalid-finalize-policy')
    }
  })
})

import { describe, expect, test } from 'bun:test'

import { createPaymentReceipt } from '../../cli/payment-receipt.ts'

describe('payment receipt', () => {
  test('binds a broadcast transaction to the exact authorization tuple', () => {
    const result = createPaymentReceipt({
      artifactHash: 'a'.repeat(64),
      atomicAmount: '1500000',
      attemptId: 'attempt-1',
      authorizationKey: 'authorization-1',
      destination: '0xprovider',
      network: 'ethereum-sepolia',
      termsHash: 'b'.repeat(64),
      transactionHash: 'c'.repeat(64),
      verificationHash: 'd'.repeat(64),
    })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.transactionHash).toBe('c'.repeat(64))
  })
})

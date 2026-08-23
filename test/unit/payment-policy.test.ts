import { describe, expect, test } from 'bun:test'

import { authorizePayment } from '../../cli/payment-policy.ts'

const hashes = {
  artifactHash: 'a'.repeat(64),
  termsHash: 'b'.repeat(64),
  verificationHash: 'c'.repeat(64),
}

const tuple = {
  asset: 'USDt' as const,
  atomicAmount: '1500000',
  destination: '0xprovider',
  network: 'ethereum-sepolia',
  sourceAccountIndex: 0,
  sourceAddress: '0xbuyer',
  sourceWallet: 'agentopoly-demo',
  token: 'usdt' as const,
}

describe('payment policy', () => {
  test('authorizes only an exact verified tuple within every configured limit', () => {
    expect(
      authorizePayment({
        ...hashes,
        agreement: { ...tuple, maximumNativeFee: '25000' },
        policy: {
          maximumAtomicAmount: '1500000',
          maximumNativeFee: '25000',
          observedSourceAddress: '0xbuyer',
          remainingAtomicAmount: '1500000',
        },
        verification: { ...hashes, passed: true },
      }),
    ).toEqual({ ok: true, value: { ...hashes, ...tuple, maximumNativeFee: '25000' } })
  })

  test('refuses a mismatched verification without producing a payment tuple', () => {
    expect(
      authorizePayment({
        ...hashes,
        agreement: { ...tuple, maximumNativeFee: '25000' },
        policy: {
          maximumAtomicAmount: '1500000',
          maximumNativeFee: '25000',
          observedSourceAddress: '0xbuyer',
          remainingAtomicAmount: '1500000',
        },
        verification: { ...hashes, artifactHash: 'd'.repeat(64), passed: true },
      }),
    ).toEqual({ ok: false, reason: 'verification-mismatch' })
  })
})

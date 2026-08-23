import { describe, expect, test } from 'bun:test'

import { createPreviewRegistry } from '../../cli/wdk-preview-registry.ts'

describe('WDK preview registry', () => {
  test('accepts one exact unexpired broadcast binding', () => {
    const registry = createPreviewRegistry()
    const preview = registry.record(
      {
        atomicAmount: '1500000',
        destination: '0xprovider',
        network: 'ethereum-sepolia',
        termsHash: 'a'.repeat(64),
        verificationHash: 'b'.repeat(64),
      },
      '42',
      100,
    )

    expect(
      registry.consume(
        {
          ...preview,
          atomicAmount: '1500000',
          destination: '0xprovider',
          network: 'ethereum-sepolia',
          termsHash: 'a'.repeat(64),
          verificationHash: 'b'.repeat(64),
        },
        99,
      ),
    ).toBe(true)
    expect(
      registry.consume(
        {
          ...preview,
          atomicAmount: '1500000',
          destination: '0xprovider',
          network: 'ethereum-sepolia',
          termsHash: 'a'.repeat(64),
          verificationHash: 'b'.repeat(64),
        },
        99,
      ),
    ).toBe(false)
  })
})

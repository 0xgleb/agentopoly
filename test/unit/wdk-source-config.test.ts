import { describe, expect, test } from 'bun:test'
import * as Effect from 'effect/Effect'

import { decodeWdkSourceConfig, enforcesWdkSourceConfig } from '../../cli/wdk-source-config.ts'

describe('WDK source configuration', () => {
  test('requires a reviewed local source wallet and account index', async () => {
    const config = await Effect.runPromise(
      decodeWdkSourceConfig({ sourceAccountIndex: '0', sourceWallet: 'agentopoly-demo' }),
    )
    expect(
      enforcesWdkSourceConfig(config, { sourceAccountIndex: 0, sourceWallet: 'agentopoly-demo' }),
    ).toBe(true)
    expect(
      enforcesWdkSourceConfig(config, { sourceAccountIndex: 1, sourceWallet: 'agentopoly-demo' }),
    ).toBe(false)
  })
})

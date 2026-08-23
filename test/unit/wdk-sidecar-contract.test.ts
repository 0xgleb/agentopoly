import { describe, expect, test } from 'bun:test'
import * as Either from 'effect/Either'
import * as Effect from 'effect/Effect'

import {
  decodeSidecarCommand,
  isPreviewStillValid,
  type SidecarFailure,
} from '../../cli/wdk-sidecar-contract.ts'

const termsHash = 'a'.repeat(64)
const artifactHash = 'b'.repeat(64)
const verificationHash = 'c'.repeat(64)

const expectFailure = async (input: unknown, tag: SidecarFailure['_tag']): Promise<void> => {
  const result = await Effect.runPromise(Effect.either(decodeSidecarCommand(input)))
  expect(Either.isLeft(result)).toBe(true)
  if (Either.isLeft(result)) expect(result.left._tag).toBe(tag)
}

describe('WDK sidecar contract', () => {
  test('accepts a fixed local source-address lookup without wallet control', async () => {
    const command = await Effect.runPromise(
      decodeSidecarCommand({
        network: 'ethereum-sepolia',
        sourceAccountIndex: 0,
        sourceWallet: 'agentopoly-demo',
        type: 'get-source-address',
      }),
    )

    expect(command.type).toBe('get-source-address')
  })

  test('accepts only a fixed exact preview request', async () => {
    const command = await Effect.runPromise(
      decodeSidecarCommand({
        asset: 'USDt',
        destination: '0xprovider',
        maximumNativeFee: '25000',
        network: 'ethereum-sepolia',
        sourceAccountIndex: 0,
        sourceWallet: 'agentopoly-demo',
        termsHash,
        token: 'usdt',
        type: 'preview-payment',
        atomicAmount: '1500000',
        artifactHash,
        verificationHash,
      }),
    )

    expect(command.type).toBe('preview-payment')
    if (command.type === 'preview-payment') {
      expect(command.atomicAmount).toBe('1500000')
    }
  })

  test('refuses a stale reserved-payment preview at broadcast time', async () => {
    const command = await Effect.runPromise(
      decodeSidecarCommand({
        artifactHash,
        asset: 'USDt',
        atomicAmount: '1500000',
        authorizationKey: 'authorization-1',
        destination: '0xprovider',
        maximumNativeFee: '25000',
        network: 'ethereum-sepolia',
        previewExpiresAt: 100,
        previewHash: 'd'.repeat(64),
        sourceAccountIndex: 0,
        sourceWallet: 'agentopoly-demo',
        termsHash,
        token: 'usdt',
        type: 'broadcast-reserved-payment',
        verificationHash,
      }),
    )
    expect(isPreviewStillValid(command, 100)).toBe(false)
  })

  test('refuses raw tool names, decimal amounts, and incomplete reserved broadcasts', async () => {
    await expectFailure({ type: 'call_method', name: 'send_token' }, 'unknown-command')
    await expectFailure(
      {
        type: 'preview-payment',
        atomicAmount: '1.5',
      },
      'invalid-command',
    )
    await expectFailure(
      {
        type: 'broadcast-reserved-payment',
        artifactHash,
        authorizationKey: 'authorization-1',
        termsHash,
        verificationHash,
      },
      'invalid-command',
    )
  })
})

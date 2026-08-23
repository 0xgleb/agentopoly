import { describe, expect, test } from 'bun:test'
import * as Effect from 'effect/Effect'

import {
  decodeBroadcastResult,
  decodePreviewResult,
  decodeSourceAddressResult,
} from '../../cli/wdk-response.ts'

describe('WDK MCP responses', () => {
  test('decodes the captured get_address result shape', async () => {
    expect(
      await Effect.runPromise(
        decodeSourceAddressResult(
          {
            content: [
              {
                text: '{"network":"ethereum-sepolia","index":0,"address":"0xbuyer"}',
                type: 'text',
              },
            ],
          },
          { index: 0, network: 'ethereum-sepolia' },
        ),
      ),
    ).toEqual({ address: '0xbuyer', index: 0, network: 'ethereum-sepolia' })
  })

  test('fails closed when WDK returns an address for a different account', async () => {
    expect(
      (
        await Effect.runPromiseExit(
          decodeSourceAddressResult(
            {
              content: [
                {
                  text: '{"network":"ethereum-sepolia","index":1,"address":"0xbuyer"}',
                  type: 'text',
                },
              ],
            },
            { index: 0, network: 'ethereum-sepolia' },
          ),
        )
      )._tag,
    ).toBe('Failure')
  })

  test('binds a WDK preview to the requested destination, amount, and network', async () => {
    const result = await Effect.runPromise(
      decodePreviewResult(
        {
          content: [
            {
              text: '{"preview":true,"network":"ethereum-sepolia","to":"0xprovider","amount":"1500000","estimatedFee":"42"}',
              type: 'text',
            },
          ],
        },
        { atomicAmount: '1500000', destination: '0xprovider', network: 'ethereum-sepolia' },
      ),
    )
    expect(result).toEqual({ estimatedNativeFee: '42' })
  })

  test('binds a WDK broadcast transaction to the exact transfer tuple', async () => {
    const result = await Effect.runPromise(
      decodeBroadcastResult(
        {
          content: [
            {
              text: `{"success":true,"network":"ethereum-sepolia","to":"0xprovider","amount":"1500000","txHash":"${'c'.repeat(64)}"}`,
              type: 'text',
            },
          ],
        },
        { atomicAmount: '1500000', destination: '0xprovider', network: 'ethereum-sepolia' },
      ),
    )
    expect(result).toEqual({ transactionHash: 'c'.repeat(64) })
  })

  test('fails closed on a non-canonical transaction hash', async () => {
    expect(
      (
        await Effect.runPromiseExit(
          decodeBroadcastResult(
            {
              content: [
                {
                  text: '{"success":true,"network":"ethereum-sepolia","to":"0xprovider","amount":"1500000","txHash":"transaction-a"}',
                  type: 'text',
                },
              ],
            },
            {
              atomicAmount: '1500000',
              destination: '0xprovider',
              network: 'ethereum-sepolia',
            },
          ),
        )
      )._tag,
    ).toBe('Failure')
  })

  test('fails closed on an incomplete response', async () => {
    expect(
      (
        await Effect.runPromiseExit(
          decodeSourceAddressResult({ content: [] }, { index: 0, network: 'ethereum-sepolia' }),
        )
      )._tag,
    ).toBe('Failure')
  })
})

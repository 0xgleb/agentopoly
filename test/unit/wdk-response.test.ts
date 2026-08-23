import { describe, expect, test } from 'bun:test'
import * as Effect from 'effect/Effect'

import { decodeSourceAddressResult } from '../../cli/wdk-response.ts'

describe('WDK MCP responses', () => {
  test('decodes the captured get_address result shape', async () => {
    expect(
      await Effect.runPromise(
        decodeSourceAddressResult({
          content: [
            { text: '{"network":"ethereum-sepolia","index":0,"address":"0xbuyer"}', type: 'text' },
          ],
        }),
      ),
    ).toEqual({ address: '0xbuyer', index: 0, network: 'ethereum-sepolia' })
  })

  test('fails closed on an incomplete response', async () => {
    expect((await Effect.runPromiseExit(decodeSourceAddressResult({ content: [] })))._tag).toBe(
      'Failure',
    )
  })
})

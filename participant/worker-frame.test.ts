import { expect, test } from 'bun:test'

import { decodeHostAdvertisementFrames } from './worker-frame.js'

test('refuses an unsigned high-bit frame length before allocating a payload', () => {
  expect(decodeHostAdvertisementFrames(Uint8Array.of(1, 255, 255, 255, 255))).toEqual({
    ok: false,
    error: 'invalid-frame',
  })
})

test('decodes a bounded host advertisement frame', () => {
  expect(decodeHostAdvertisementFrames(Uint8Array.of(1, 0, 0, 0, 2, 8, 9))).toEqual({
    ok: true,
    value: [Uint8Array.of(8, 9)],
  })
})

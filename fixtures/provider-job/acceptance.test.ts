import { describe, expect, test } from 'bun:test'

import { normalizeMarketHandle } from './submission.ts'

describe('normalizeMarketHandle acceptance contract', () => {
  test('normalizes a valid market handle', () => {
    expect(normalizeMarketHandle('  Reliable-Provider7  ')).toEqual({
      ok: true,
      value: 'reliable-provider7',
    })
  })

  test('rejects empty and invalid handles', () => {
    expect(normalizeMarketHandle('   ')).toEqual({ ok: false, reason: 'empty' })
    expect(normalizeMarketHandle('provider_bad')).toEqual({
      ok: false,
      reason: 'invalid-character',
    })
  })

  test('accepts exactly sixteen UTF-8 bytes and rejects seventeen', () => {
    expect(normalizeMarketHandle('abcdefghijklmnop')).toEqual({
      ok: true,
      value: 'abcdefghijklmnop',
    })
    expect(normalizeMarketHandle('abcdefghijklmnopq')).toEqual({
      ok: false,
      reason: 'too-long',
    })
  })

  test('checks UTF-8 bytes before the allowed-character rule', () => {
    expect(normalizeMarketHandle('😀😀😀😀😀')).toEqual({
      ok: false,
      reason: 'too-long',
    })
  })
})

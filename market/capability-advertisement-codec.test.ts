import { expect, test } from 'bun:test'

import { decodeCapabilityAdvertisement } from './capability-advertisement-codec.ts'

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values)
const u64 = (value: number): readonly number[] => [
  Math.floor(value / 2 ** 56) & 255,
  Math.floor(value / 2 ** 48) & 255,
  Math.floor(value / 2 ** 40) & 255,
  Math.floor(value / 2 ** 32) & 255,
  Math.floor(value / 2 ** 24) & 255,
  Math.floor(value / 2 ** 16) & 255,
  Math.floor(value / 2 ** 8) & 255,
  value & 255,
]
const field = (value: string): readonly number[] => [
  0,
  value.length,
  ...value.split('').map((character) => character.charCodeAt(0)),
]

const validAdvertisement = bytes(
  1,
  0,
  ...u64(1_300),
  ...u64(1),
  ...field('coding.fixture'),
  ...field('provider-a'),
  ...field('typescript patch'),
  ...field('validated patch artifact'),
  ...field('one file'),
  ...field('1000 atomic USDt'),
  ...field('one verified receipt'),
)

test('decodes a bounded binary capability advertisement payload', () => {
  expect(decodeCapabilityAdvertisement(validAdvertisement)).toEqual({
    ok: true,
    value: {
      capabilityId: 'coding.fixture',
      evidenceSummary: 'one verified receipt',
      expiresAt: 1_300,
      inputContract: 'typescript patch',
      outputContract: 'validated patch artifact',
      limits: 'one file',
      priceBasis: '1000 atomic USDt',
      providerIdentity: 'provider-a',
      revision: 1,
      withdrawal: false,
    },
  })
})

test('rejects a payload with a trailing or truncated field', () => {
  expect(decodeCapabilityAdvertisement(validAdvertisement.slice(0, -1))).toEqual({
    ok: false,
    error: 'malformed-advertisement',
  })
  expect(decodeCapabilityAdvertisement(bytes(...validAdvertisement, 0))).toEqual({
    ok: false,
    error: 'malformed-advertisement',
  })
})

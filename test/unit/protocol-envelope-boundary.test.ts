import { expect, test } from 'bun:test'

import {
  admitEnvelope,
  createInMemoryReplayStore,
  decodeEnvelope,
  encodeEnvelope,
  encodeProtocolFixture,
  type EnvelopeInput,
} from '../../protocol/envelope-boundary.ts'

const envelope: EnvelopeInput = {
  version: 1,
  kind: 'job.request',
  compression: 0,
  messageId: 'message-1',
  senderIdentity: 'sender-1',
  audience: 'recipient-1',
  keyRevision: 'key-1',
  sentAt: 1_000,
  expiresAt: 1_300,
  correlationId: 'correlation-1',
  nonce: 1,
  payload: Uint8Array.of(1, 2, 3),
  signature: Uint8Array.of(4),
}

test('encodes a fixed protocol fixture as canonical bytes', () => {
  const result = encodeProtocolFixture()
  expect(result.ok).toBe(true)
  if (!result.ok) return

  expect(Array.from(result.value)).toEqual([
    65, 79, 80, 1, 1, 0, 0, 9, 109, 101, 115, 115, 97, 103, 101, 45, 49, 0, 8, 115, 101, 110, 100,
    101, 114, 45, 49, 0, 11, 114, 101, 99, 105, 112, 105, 101, 110, 116, 45, 49, 0, 5, 107, 101,
    121, 45, 49, 0, 0, 0, 0, 0, 0, 3, 232, 0, 0, 0, 0, 0, 0, 5, 20, 0, 13, 99, 111, 114, 114, 101,
    108, 97, 116, 105, 111, 110, 45, 49, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 3, 1, 2, 3, 0, 0, 3, 144,
    88, 198, 242, 192, 203, 73, 44, 83, 59, 10, 77, 20, 239, 119, 204, 15, 120, 171, 204, 206, 213,
    40, 125, 132, 161, 162, 1, 28, 251, 129, 0, 1, 4,
  ])
})

test('binds the payload SHA-256 in canonical envelope bytes', () => {
  const result = encodeEnvelope(envelope)

  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(result.value).toBeInstanceOf(Uint8Array)
    expect(Array.from(result.value.slice(-35, -3))).toEqual([
      3, 144, 88, 198, 242, 192, 203, 73, 44, 83, 59, 10, 77, 20, 239, 119, 204, 15, 120, 171, 204,
      206, 213, 40, 125, 132, 161, 162, 1, 28, 251, 129,
    ])
  }
})

test('refuses an unknown protocol version', () => {
  const encoded = encodeEnvelope(envelope)
  expect(encoded.ok).toBe(true)
  if (!encoded.ok) return
  const unsupported = encoded.value.slice()
  unsupported[3] = 2

  expect(
    decodeEnvelope(unsupported, {
      now: 1_050,
      verify: () => ({ ok: true, value: undefined }),
    }),
  ).toEqual({ ok: false, error: 'unknown-version' })
})

test('returns the injected signature refusal after structural validation', () => {
  const encoded = encodeEnvelope(envelope)
  expect(encoded.ok).toBe(true)
  if (!encoded.ok) return

  expect(
    decodeEnvelope(encoded.value, {
      now: 1_050,
      verify: () => ({ ok: false, error: 'invalid-signature' }),
    }),
  ).toEqual({ ok: false, error: 'invalid-signature' })
})

test('rejects a compressed v1 envelope marker', () => {
  const encoded = encodeEnvelope(envelope)
  expect(encoded.ok).toBe(true)
  if (!encoded.ok) return
  const compressed = encoded.value.slice()
  compressed[5] = 1

  expect(
    decodeEnvelope(compressed, {
      now: 1_050,
      verify: () => ({ ok: true, value: undefined }),
    }),
  ).toEqual({ ok: false, error: 'invalid-field' })
})

test('admits nonce gaps but refuses a delayed nonce without replacing the high-water mark', () => {
  const store = createInMemoryReplayStore()
  const first = encodeEnvelope({ ...envelope, nonce: 1 })
  const gap = encodeEnvelope({ ...envelope, messageId: 'message-2', nonce: 3 })
  const delayed = encodeEnvelope({ ...envelope, messageId: 'message-3', nonce: 2 })
  expect(first.ok && gap.ok && delayed.ok).toBe(true)
  if (!first.ok || !gap.ok || !delayed.ok) return

  expect(admitEnvelope(envelope, first.value, 'accepted', store)).toEqual({
    ok: true,
    value: { outcome: 'accepted', result: 'accepted' },
  })
  expect(
    admitEnvelope({ ...envelope, messageId: 'message-2', nonce: 3 }, gap.value, 'accepted', store),
  ).toEqual({
    ok: true,
    value: { outcome: 'accepted', result: 'accepted' },
  })
  expect(
    admitEnvelope(
      { ...envelope, messageId: 'message-3', nonce: 2 },
      delayed.value,
      'accepted',
      store,
    ),
  ).toEqual({
    ok: false,
    error: 'replayed',
  })
})

test('refuses a payload substitution before signature admission', () => {
  const encoded = encodeEnvelope(envelope)
  expect(encoded.ok).toBe(true)
  if (!encoded.ok) return
  const substituted = encoded.value.slice()
  substituted[90] = 9

  expect(
    decodeEnvelope(substituted, {
      now: 1_050,
      verify: () => ({ ok: true, value: undefined }),
    }),
  ).toEqual({ ok: false, error: 'invalid-payload-hash' })
})

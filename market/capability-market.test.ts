import { expect, test } from 'bun:test'

import { createCapabilityMarket } from './capability-market.ts'
import type { ProtocolEnvelope } from '../protocol/envelope-boundary.ts'

const advertisement = {
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
}

test('keeps the newest live advertisement for each provider capability', () => {
  const market = createCapabilityMarket()

  expect(market.apply(advertisement, 1_000)).toEqual({ ok: true, value: 'accepted' })
  expect(market.apply({ ...advertisement, revision: 1 }, 1_001)).toEqual({
    ok: true,
    value: 'duplicate',
  })
  expect(
    market.apply({ ...advertisement, revision: 2, priceBasis: '900 atomic USDt' }, 1_002),
  ).toEqual({
    ok: true,
    value: 'accepted',
  })
  expect(market.live(1_003)).toEqual([
    expect.objectContaining({ priceBasis: '900 atomic USDt', revision: 2 }),
  ])
})

test('treats reordered equivalent advertisements as a duplicate', () => {
  const market = createCapabilityMarket()
  const reordered = {
    withdrawal: false,
    revision: 1,
    providerIdentity: 'provider-a',
    priceBasis: '1000 atomic USDt',
    limits: 'one file',
    inputContract: 'typescript patch',
    outputContract: 'validated patch artifact',
    expiresAt: 1_300,
    evidenceSummary: 'one verified receipt',
    capabilityId: 'coding.fixture',
  }
  market.apply(advertisement, 1_000)

  expect(market.apply(reordered, 1_001)).toEqual({ ok: true, value: 'duplicate' })
})

test('refuses an advertisement whose provider does not match the verified envelope sender', () => {
  const market = createCapabilityMarket()
  const envelope: ProtocolEnvelope = {
    version: 1,
    kind: 'capability.advertise',
    compression: 0,
    messageId: 'message-1',
    senderIdentity: 'provider-b',
    audience: 'market',
    keyRevision: 'key-1',
    sentAt: 1_000,
    expiresAt: 1_300,
    correlationId: 'correlation-1',
    nonce: 1,
    payload: new Uint8Array(),
    payloadHash: new Uint8Array(32),
    signature: Uint8Array.of(1),
  }

  expect(market.applyVerified(envelope, advertisement, 1_000)).toEqual({
    ok: false,
    error: 'sender-mismatch',
  })
})

test('refuses a non-advertisement envelope before it mutates the market', () => {
  const market = createCapabilityMarket()
  const envelope: ProtocolEnvelope = {
    version: 1,
    kind: 'job.request',
    compression: 0,
    messageId: 'message-1',
    senderIdentity: 'provider-a',
    audience: 'market',
    keyRevision: 'key-1',
    sentAt: 1_000,
    expiresAt: 1_300,
    correlationId: 'correlation-1',
    nonce: 1,
    payload: new Uint8Array(),
    payloadHash: new Uint8Array(32),
    signature: Uint8Array.of(1),
  }

  expect(market.applyVerified(envelope, advertisement, 1_000)).toEqual({
    ok: false,
    error: 'sender-mismatch',
  })
  expect(market.live(1_000)).toEqual([])
})

test('refuses a malformed advertised payload before market mutation', () => {
  const market = createCapabilityMarket()
  const envelope: ProtocolEnvelope = {
    version: 1,
    kind: 'capability.advertise',
    compression: 0,
    messageId: 'message-1',
    senderIdentity: 'provider-a',
    audience: 'market',
    keyRevision: 'key-1',
    sentAt: 1_000,
    expiresAt: 1_300,
    correlationId: 'correlation-1',
    nonce: 1,
    payload: Uint8Array.of(1),
    payloadHash: new Uint8Array(32),
    signature: Uint8Array.of(1),
  }

  expect(market.applyEnvelope(envelope, 1_000)).toEqual({
    ok: false,
    error: 'malformed-advertisement',
  })
  expect(market.live(1_000)).toEqual([])
})

test('refuses a conflicting update at an existing revision', () => {
  const market = createCapabilityMarket()
  market.apply(advertisement, 1_000)

  expect(market.apply({ ...advertisement, priceBasis: '900 atomic USDt' }, 1_001)).toEqual({
    ok: false,
    error: 'conflict',
  })
})

test('does not revive a withdrawn capability from a stale reconnect', () => {
  const market = createCapabilityMarket()
  market.apply(advertisement, 1_000)
  market.apply({ ...advertisement, revision: 2, withdrawal: true }, 1_001)

  expect(market.apply(advertisement, 1_002)).toEqual({ ok: false, error: 'stale' })
  expect(market.live(1_002)).toEqual([])
})

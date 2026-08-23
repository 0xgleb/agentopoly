import { describe, expect, test } from 'bun:test'

import { createCapabilityMarket, type CapabilityAdvertisement } from './capability-market.ts'
import { createCapabilityObservationRecorder } from './capability-observation.ts'
import { hashProtocolBytes, type ProtocolEnvelope } from '../protocol/envelope-boundary.ts'

const advertisement = {
  capabilityId: 'coding.fixture',
  evidenceSummary: 'signed local capability advertisement',
  expiresAt: 2_000,
  inputContract: 'utf8 source',
  limits: 'one source file',
  outputContract: 'normalized source',
  priceBasis: '1000 atomic USDt',
  providerIdentity: 'provider-a',
  revision: 1,
  withdrawal: false,
} as const

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

const encodeAdvertisement = (value: CapabilityAdvertisement): Uint8Array =>
  Uint8Array.from([
    1,
    value.withdrawal ? 1 : 0,
    ...u64(value.expiresAt),
    ...u64(value.revision),
    ...field(value.capabilityId),
    ...field(value.providerIdentity),
    ...field(value.inputContract),
    ...field(value.outputContract),
    ...field(value.limits),
    ...field(value.priceBasis),
    ...field(value.evidenceSummary),
  ])

const envelope = (): ProtocolEnvelope => {
  const payload = encodeAdvertisement(advertisement)
  return {
    audience: 'buyer-a',
    compression: 0,
    correlationId: 'capability-a',
    expiresAt: 2_000,
    keyRevision: 'key-a',
    kind: 'capability.advertise',
    messageId: 'capability-message-a',
    nonce: 1,
    payload,
    payloadHash: hashProtocolBytes(payload),
    senderIdentity: 'provider-a',
    sentAt: 1_000,
    signature: new Uint8Array(64),
    version: 1,
  }
}

describe('capability observation evidence', () => {
  test('records one live-peer observation only after market admission', () => {
    const events: unknown[] = []
    const recorder = createCapabilityObservationRecorder(createCapabilityMarket(), (event) => {
      events.push(event)
    })

    expect(recorder.observe(envelope(), 1_000, '2026-08-23T00:00:00.000Z')).toEqual({
      ok: true,
      value: 'accepted',
    })
    expect(recorder.observe(envelope(), 1_000, '2026-08-23T00:00:01.000Z')).toEqual({
      ok: true,
      value: 'duplicate',
    })
    expect(events).toEqual([
      expect.objectContaining({
        capabilityId: 'coding.fixture',
        evidenceSource: 'live-peer',
        envelopeMessageId: 'capability-message-a',
        envelopeSenderIdentity: 'provider-a',
        providerIdentity: 'provider-a',
        type: 'capability.observed',
      }),
    ])
  })

  test('does not record malformed, expired, or withdrawn advertisements', () => {
    const events: unknown[] = []
    const recorder = createCapabilityObservationRecorder(createCapabilityMarket(), (event) => {
      events.push(event)
    })
    const malformed = { ...envelope(), payload: Uint8Array.of(1) }
    const expiredPayload = encodeAdvertisement({ ...advertisement, expiresAt: 1_000 })
    const expired = {
      ...envelope(),
      expiresAt: 1_000,
      payload: expiredPayload,
      payloadHash: hashProtocolBytes(expiredPayload),
    }
    const withdrawal = encodeAdvertisement({ ...advertisement, withdrawal: true, revision: 2 })

    expect(recorder.observe(malformed, 1_000, '2026-08-23T00:00:00.000Z').ok).toBe(false)
    expect(recorder.observe(expired, 1_000, '2026-08-23T00:00:00.000Z').ok).toBe(false)
    expect(
      recorder.observe(
        {
          ...envelope(),
          messageId: 'withdrawal-a',
          payload: withdrawal,
          payloadHash: hashProtocolBytes(withdrawal),
        },
        1_000,
        '2026-08-23T00:00:00.000Z',
      ).ok,
    ).toBe(true)
    expect(events).toHaveLength(0)
  })
})

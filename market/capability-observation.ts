import type { ProtocolEnvelope } from '../protocol/envelope-boundary.ts'

import { decodeCapabilityAdvertisement } from './capability-advertisement-codec.ts'
import type {
  CapabilityMarket,
  CapabilityMarketResponse,
  CapabilityMarketResult,
} from './capability-market.ts'

export type CapabilityObservedEvent = Readonly<{
  readonly capabilityId: string
  readonly envelopeKeyRevision: string
  readonly envelopeMessageId: string
  readonly envelopePayloadHash: string
  readonly envelopeSenderIdentity: string
  readonly evidenceHash: string
  readonly evidenceSource: 'live-peer'
  readonly evidenceSummary: string
  readonly expiresAt: number
  readonly inputContract: string
  readonly limits: string
  readonly outputContract: string
  readonly priceBasis: string
  readonly providerIdentity: string
  readonly recordedAt: string
  readonly revision: number
  readonly schemaVersion: 1
  readonly type: 'capability.observed'
  readonly withdrawal: boolean
}>

export type CapabilityObservationRecorder = Readonly<{
  readonly observe: (
    envelope: ProtocolEnvelope,
    observedAt: number,
    recordedAt: string,
  ) => CapabilityMarketResponse
}>

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')

const observedEvent = (
  envelope: ProtocolEnvelope,
  recordedAt: string,
): CapabilityObservedEvent | undefined => {
  const advertisement = decodeCapabilityAdvertisement(envelope.payload)
  if (!advertisement.ok) return undefined

  return {
    capabilityId: advertisement.value.capabilityId,
    envelopeKeyRevision: envelope.keyRevision,
    envelopeMessageId: envelope.messageId,
    envelopePayloadHash: hex(envelope.payloadHash),
    envelopeSenderIdentity: envelope.senderIdentity,
    evidenceHash: hex(envelope.payloadHash),
    evidenceSource: 'live-peer',
    evidenceSummary: advertisement.value.evidenceSummary,
    expiresAt: advertisement.value.expiresAt,
    inputContract: advertisement.value.inputContract,
    limits: advertisement.value.limits,
    outputContract: advertisement.value.outputContract,
    priceBasis: advertisement.value.priceBasis,
    providerIdentity: advertisement.value.providerIdentity,
    recordedAt,
    revision: advertisement.value.revision,
    schemaVersion: 1,
    type: 'capability.observed',
    withdrawal: advertisement.value.withdrawal,
  }
}

export const createCapabilityObservationRecorder = (
  market: CapabilityMarket,
  append: (event: CapabilityObservedEvent) => void,
): CapabilityObservationRecorder => {
  const observe = (
    envelope: ProtocolEnvelope,
    observedAt: number,
    recordedAt: string,
  ): CapabilityMarketResponse => {
    const response = market.applyEnvelope(envelope, observedAt)
    if (!response.ok || response.value !== ('accepted' satisfies CapabilityMarketResult))
      return response

    const event = observedEvent(envelope, recordedAt)
    if (event !== undefined && !event.withdrawal) append(event)
    return response
  }

  return { observe }
}

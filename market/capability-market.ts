import type { ProtocolEnvelope } from '../protocol/envelope-boundary.ts'

import { decodeCapabilityAdvertisement } from './capability-advertisement-codec.ts'

export type CapabilityAdvertisement = Readonly<{
  readonly capabilityId: string
  readonly evidenceSummary: string
  readonly expiresAt: number
  readonly inputContract: string
  readonly outputContract: string
  readonly limits: string
  readonly priceBasis: string
  readonly providerIdentity: string
  readonly revision: number
  readonly withdrawal: boolean
}>

export type CapabilityMarketFailure =
  | 'conflict'
  | 'expired'
  | 'invalid-advertisement'
  | 'malformed-advertisement'
  | 'sender-mismatch'
  | 'stale'
export type CapabilityMarketResult = 'accepted' | 'duplicate'
export type CapabilityMarketResponse =
  | Readonly<{ readonly ok: true; readonly value: CapabilityMarketResult }>
  | Readonly<{ readonly ok: false; readonly error: CapabilityMarketFailure }>

export type CapabilityMarket = Readonly<{
  readonly apply: (
    advertisement: CapabilityAdvertisement,
    observedAt: number,
  ) => CapabilityMarketResponse
  readonly applyEnvelope: (
    envelope: ProtocolEnvelope,
    observedAt: number,
  ) => CapabilityMarketResponse
  readonly applyVerified: (
    envelope: ProtocolEnvelope,
    advertisement: CapabilityAdvertisement,
    observedAt: number,
  ) => CapabilityMarketResponse
  readonly live: (observedAt: number) => readonly CapabilityAdvertisement[]
}>

const accepted = (value: CapabilityMarketResult): CapabilityMarketResponse => ({ ok: true, value })
const refused = (error: CapabilityMarketFailure): CapabilityMarketResponse => ({ ok: false, error })

const keyFor = (advertisement: CapabilityAdvertisement): string =>
  `${advertisement.providerIdentity}\u0000${advertisement.capabilityId}`

const equalAdvertisement = (
  left: CapabilityAdvertisement,
  right: CapabilityAdvertisement,
): boolean =>
  left.capabilityId === right.capabilityId &&
  left.evidenceSummary === right.evidenceSummary &&
  left.expiresAt === right.expiresAt &&
  left.inputContract === right.inputContract &&
  left.outputContract === right.outputContract &&
  left.limits === right.limits &&
  left.priceBasis === right.priceBasis &&
  left.providerIdentity === right.providerIdentity &&
  left.revision === right.revision &&
  left.withdrawal === right.withdrawal

const isValid = (advertisement: CapabilityAdvertisement): boolean => {
  const strings = [
    advertisement.capabilityId,
    advertisement.evidenceSummary,
    advertisement.inputContract,
    advertisement.outputContract,
    advertisement.limits,
    advertisement.priceBasis,
    advertisement.providerIdentity,
  ]

  return (
    strings.every((value) => value.trim().length > 0 && value.length <= 1_024) &&
    Number.isSafeInteger(advertisement.expiresAt) &&
    Number.isSafeInteger(advertisement.revision) &&
    advertisement.expiresAt >= 0 &&
    advertisement.revision >= 1
  )
}

export const createCapabilityMarket = (): CapabilityMarket => {
  const entries = new Map<string, CapabilityAdvertisement>()

  const apply = (
    advertisement: CapabilityAdvertisement,
    observedAt: number,
  ): CapabilityMarketResponse => {
    if (!isValid(advertisement) || !Number.isSafeInteger(observedAt) || observedAt < 0) {
      return refused('invalid-advertisement')
    }

    if (advertisement.expiresAt <= observedAt && !advertisement.withdrawal) {
      return refused('expired')
    }

    const key = keyFor(advertisement)
    const current = entries.get(key)

    if (current !== undefined) {
      if (advertisement.revision < current.revision) return refused('stale')
      if (advertisement.revision === current.revision) {
        return equalAdvertisement(advertisement, current)
          ? accepted('duplicate')
          : refused('conflict')
      }
    }

    entries.set(key, advertisement)
    return accepted('accepted')
  }

  const applyEnvelope = (
    envelope: ProtocolEnvelope,
    observedAt: number,
  ): CapabilityMarketResponse => {
    const decoded = decodeCapabilityAdvertisement(envelope.payload)
    return decoded.ok ? applyVerified(envelope, decoded.value, observedAt) : refused(decoded.error)
  }

  const applyVerified = (
    envelope: ProtocolEnvelope,
    advertisement: CapabilityAdvertisement,
    observedAt: number,
  ): CapabilityMarketResponse => {
    if (
      envelope.kind !== 'capability.advertise' ||
      envelope.senderIdentity !== advertisement.providerIdentity
    ) {
      return refused('sender-mismatch')
    }

    return apply(advertisement, observedAt)
  }

  const live = (observedAt: number): readonly CapabilityAdvertisement[] =>
    [...entries.values()].filter(
      (advertisement) => !advertisement.withdrawal && advertisement.expiresAt > observedAt,
    )

  return { apply, applyEnvelope, applyVerified, live }
}

import { decodeUtf8 } from '../protocol/envelope-boundary.ts'

import type { CapabilityAdvertisement } from './capability-market.ts'

export type AdvertisementCodecResult =
  | Readonly<{ readonly ok: true; readonly value: CapabilityAdvertisement }>
  | Readonly<{ readonly ok: false; readonly error: 'malformed-advertisement' }>

const malformed = (): AdvertisementCodecResult => ({ ok: false, error: 'malformed-advertisement' })

export const decodeCapabilityAdvertisement = (payload: Uint8Array): AdvertisementCodecResult => {
  let offset = 0
  const take = (length: number): Uint8Array | undefined => {
    if (length < 0 || offset + length > payload.length) return undefined
    const value = payload.slice(offset, offset + length)
    offset += length
    return value
  }
  const number = (length: number): number | undefined =>
    take(length)?.reduce((total, byte) => total * 256 + byte, 0)
  const field = (): string | undefined => {
    const length = number(2)
    if (length === undefined || length > 1_024) return undefined
    const value = take(length)
    const decoded = value ? decodeUtf8(value) : undefined
    return decoded && decoded.length > 0 ? decoded : undefined
  }

  const version = number(1)
  const flags = number(1)
  const expiresAt = number(8)
  const revision = number(8)
  const capabilityId = field()
  const providerIdentity = field()
  const inputContract = field()
  const outputContract = field()
  const limits = field()
  const priceBasis = field()
  const evidenceSummary = field()

  if (
    version !== 1 ||
    flags === undefined ||
    flags > 1 ||
    expiresAt === undefined ||
    revision === undefined ||
    !Number.isSafeInteger(expiresAt) ||
    !Number.isSafeInteger(revision) ||
    !capabilityId ||
    !providerIdentity ||
    !inputContract ||
    !outputContract ||
    !limits ||
    !priceBasis ||
    !evidenceSummary ||
    offset !== payload.length
  ) {
    return malformed()
  }

  return {
    ok: true,
    value: {
      capabilityId,
      evidenceSummary,
      expiresAt,
      inputContract,
      outputContract,
      limits,
      priceBasis,
      providerIdentity,
      revision,
      withdrawal: flags === 1,
    },
  }
}

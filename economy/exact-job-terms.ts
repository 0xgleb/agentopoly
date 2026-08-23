import * as Brand from 'effect/Brand'
import * as Effect from 'effect/Effect'

import {
  AtomicAmount,
  type EvidenceHash,
  type JobId,
  type NetworkId,
  type ParticipantId,
  type WalletDestination,
} from './job-lifecycle.ts'
import { hashProtocolBytes } from '../protocol/envelope-boundary.ts'

export type ServiceId = string & Brand.Brand<'ServiceId'>
export const ServiceId = Brand.refined<ServiceId>(
  (value) => value.trim().length > 0 && value.length <= 256,
  () => Brand.error('service ID must be non-empty and bounded'),
)

export type TokenContract = string & Brand.Brand<'TokenContract'>
export const TokenContract = Brand.refined<TokenContract>(
  (value) => value.trim().length > 0 && value.length <= 256,
  () => Brand.error('token contract must be non-empty and bounded'),
)

export type TermsHash = string & Brand.Brand<'TermsHash'>
export const TermsHash = Brand.refined<TermsHash>(
  (value) => /^[a-f0-9]{64}$/.test(value),
  () => Brand.error('terms hash must be 32 lowercase hexadecimal bytes'),
)

export type TermsSignature = Uint8Array & Brand.Brand<'TermsSignature'>
export const TermsSignature = Brand.refined<TermsSignature>(
  (value) => value.length > 0 && value.length <= 1024,
  () => Brand.error('terms signature must be non-empty and bounded'),
)

export type ExactJobTerms = Readonly<{
  readonly acceptanceContractHash: EvidenceHash
  readonly artifactContractHash: EvidenceHash
  readonly asset: 'USDt'
  readonly bidExpiry: number
  readonly buyer: ParticipantId
  readonly buyerWallet: WalletDestination
  readonly decimals: 6
  readonly destination: WalletDestination
  readonly executionDeadline: number
  readonly jobId: JobId
  readonly maximumNativeFee: AtomicAmount
  readonly network: NetworkId
  readonly price: AtomicAmount
  readonly provider: ParticipantId
  readonly serviceId: ServiceId
  readonly taskInputHash: EvidenceHash
  readonly tokenContract: TokenContract
}>

export type SignedTerms = Readonly<{
  readonly signer: ParticipantId
  readonly signature: TermsSignature
}>

export type AgreedTerms = Readonly<{
  readonly buyerSignature: TermsSignature
  readonly canonicalBytes: Uint8Array
  readonly providerSignature: TermsSignature
  readonly terms: ExactJobTerms
  readonly termsHash: TermsHash
}>

export type TermsFailure = Readonly<{
  readonly _tag:
    | 'agreement-conflict'
    | 'counterparty-signature-missing'
    | 'invalid-terms'
    | 'signature-invalid'
    | 'terms-expired'
  readonly reason: string
}>

export type TermsSignatureVerifier = Readonly<{
  readonly verify: (
    input: Readonly<{
      readonly bytes: Uint8Array
      readonly signer: ParticipantId
      readonly signature: TermsSignature
    }>,
  ) => Effect.Effect<void, TermsFailure>
}>

export type AgreementAdmission = Readonly<{
  readonly agreement: AgreedTerms
  readonly outcome: 'accepted' | 'duplicate'
}>

export type AgreementStore = Readonly<{
  readonly find: (jobId: JobId) => AgreedTerms | undefined
  readonly record: (agreement: AgreedTerms) => void
}>

const failure = (tag: TermsFailure['_tag'], reason: string): TermsFailure => ({ _tag: tag, reason })

const join = (parts: readonly Uint8Array[]): Uint8Array => {
  const length = parts.reduce((total, part) => total + part.length, 0)
  const output = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}

const u32 = (value: number): Uint8Array =>
  Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value & 255)

const u64 = (value: number): Uint8Array =>
  join([u32(Math.floor(value / 4_294_967_296)), u32(value >>> 0)])

const field = (value: string): Uint8Array => {
  const encoded = new TextEncoder().encode(value)
  return join([u32(encoded.length), encoded])
}

const asHex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')

const validTerms = (terms: ExactJobTerms): TermsFailure | undefined => {
  if (
    !Number.isSafeInteger(terms.bidExpiry) ||
    !Number.isSafeInteger(terms.executionDeadline) ||
    terms.bidExpiry < 0 ||
    terms.executionDeadline < terms.bidExpiry
  ) {
    return failure('invalid-terms', 'terms deadlines must be ordered safe integers')
  }
  if (terms.buyer === terms.provider) {
    return failure('invalid-terms', 'buyer and provider must be distinct identities')
  }
  return undefined
}

export const encodeExactJobTerms = (
  terms: ExactJobTerms,
): Effect.Effect<Uint8Array, TermsFailure> => {
  const invalid = validTerms(terms)
  if (invalid !== undefined) return Effect.fail(invalid)

  return Effect.succeed(
    join([
      Uint8Array.of(1),
      field(terms.jobId),
      field(terms.buyer),
      field(terms.provider),
      field(terms.serviceId),
      field(terms.taskInputHash),
      field(terms.acceptanceContractHash),
      field(terms.artifactContractHash),
      field(terms.network),
      field(terms.asset),
      field(terms.tokenContract),
      Uint8Array.of(terms.decimals),
      field(terms.price.toString()),
      field(terms.buyerWallet),
      field(terms.destination),
      field(terms.maximumNativeFee.toString()),
      u64(terms.bidExpiry),
      u64(terms.executionDeadline),
    ]),
  )
}

const signatureFor = (
  signatures: readonly SignedTerms[],
  signer: ParticipantId,
): TermsSignature | undefined => {
  const matching = signatures.filter((candidate) => candidate.signer === signer)
  return matching.length === 1 ? matching[0]?.signature : undefined
}

export const createInMemoryAgreementStore = (): AgreementStore => {
  const agreements = new Map<JobId, AgreedTerms>()
  return {
    find: (jobId) => agreements.get(jobId),
    record: (agreement) => agreements.set(agreement.terms.jobId, agreement),
  }
}

export const admitExactJobTerms = (
  agreement: AgreedTerms,
  store: AgreementStore,
): Effect.Effect<AgreementAdmission, TermsFailure> => {
  const previous = store.find(agreement.terms.jobId)
  if (previous !== undefined) {
    return previous.termsHash === agreement.termsHash
      ? Effect.succeed({ agreement: previous, outcome: 'duplicate' })
      : Effect.fail(failure('agreement-conflict', 'job already has a different agreed terms hash'))
  }
  store.record(agreement)
  return Effect.succeed({ agreement, outcome: 'accepted' })
}

export const agreeExactJobTerms = (
  terms: ExactJobTerms,
  signatures: readonly SignedTerms[],
  now: number,
  verifier: TermsSignatureVerifier,
): Effect.Effect<AgreedTerms, TermsFailure> =>
  Effect.gen(function* () {
    if (!Number.isSafeInteger(now) || now < 0) {
      return yield* Effect.fail(failure('invalid-terms', 'agreement time must be a safe integer'))
    }
    const canonicalBytes = yield* encodeExactJobTerms(terms)
    if (now > terms.bidExpiry) {
      return yield* Effect.fail(failure('terms-expired', 'bid expiry passed before agreement'))
    }
    const buyerSignature = signatureFor(signatures, terms.buyer)
    const providerSignature = signatureFor(signatures, terms.provider)
    if (
      buyerSignature === undefined ||
      providerSignature === undefined ||
      signatures.length !== 2
    ) {
      return yield* Effect.fail(
        failure(
          'counterparty-signature-missing',
          'exactly one signature from each party is required',
        ),
      )
    }

    yield* verifier.verify({
      bytes: canonicalBytes,
      signer: terms.buyer,
      signature: buyerSignature,
    })
    yield* verifier.verify({
      bytes: canonicalBytes,
      signer: terms.provider,
      signature: providerSignature,
    })

    return {
      buyerSignature,
      canonicalBytes,
      providerSignature,
      terms,
      termsHash: TermsHash(asHex(hashProtocolBytes(canonicalBytes))),
    }
  })

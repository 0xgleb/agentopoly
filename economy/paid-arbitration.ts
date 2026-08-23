import * as Brand from 'effect/Brand'
import * as Effect from 'effect/Effect'

import type { EvidenceHash, JobId } from './job-lifecycle.ts'
import type {
  AgreedTerms,
  TermsHash,
  TermsSignature,
  TermsSignatureVerifier,
} from './exact-job-terms.ts'
import { hashProtocolBytes } from '../protocol/envelope-boundary.ts'
import { createPaymentReceipt, type PaymentReceipt } from '../cli/payment-receipt.ts'

export type DisputeId = string & Brand.Brand<'DisputeId'>
export const DisputeId = Brand.refined<DisputeId>(
  (value) => value.trim().length > 0 && value.length <= 256,
  () => Brand.error('dispute ID must be bounded'),
)

export type DisputeStatement = string & Brand.Brand<'DisputeStatement'>
export const DisputeStatement = Brand.refined<DisputeStatement>(
  (value) => value.trim().length > 0 && new TextEncoder().encode(value).byteLength <= 4096,
  () => Brand.error('dispute statement must be bounded'),
)

export type FailedOriginalVerification = Readonly<{
  readonly _tag: 'failed-original-verification'
  readonly artifactHash: EvidenceHash
  readonly jobId: JobId
  readonly termsHash: EvidenceHash
  readonly verificationHash: EvidenceHash
}>

export type DisputeHash = string & Brand.Brand<'DisputeHash'>
export const DisputeHash = Brand.refined<DisputeHash>(
  (value) => /^[a-f0-9]{64}$/.test(value),
  () => Brand.error('dispute hash must be 32 lowercase hexadecimal bytes'),
)

export type DisputeBundle = Readonly<{
  readonly disputeId: DisputeId
  readonly original: FailedOriginalVerification
  readonly statement: DisputeStatement
  readonly submittedAt: number
}>

export type AdmittedDispute = DisputeBundle &
  Readonly<{ readonly paymentAuthority: 'arbitration-job-only' }>
export type SignedArbitrationRuling = Readonly<{
  readonly arbitrationTermsHash: TermsHash
  readonly disputeHash: DisputeHash
  readonly issuedAt: number
  readonly outcome: 'buyer-prevails' | 'provider-prevails'
  readonly rulingArtifactHash: EvidenceHash
  readonly rulingVerificationHash: EvidenceHash
  readonly signature: TermsSignature
}>

export type ArbitrationSettlementIntent = Readonly<{
  readonly arbitrationJobId: JobId
  readonly arbitrationTermsHash: TermsHash
  readonly disputeHash: DisputeHash
  readonly paymentAuthority: 'arbitration-job-only'
  readonly rulingArtifactHash: EvidenceHash
  readonly rulingOutcome: SignedArbitrationRuling['outcome']
  readonly rulingVerificationHash: EvidenceHash
}>

export type ArbitrationFailure = Readonly<{
  readonly _tag: 'conflicting-dispute' | 'invalid-dispute' | 'invalid-ruling' | 'stale-dispute'
  readonly reason: string
}>
export type DisputeStore = Readonly<{
  readonly find: (disputeId: DisputeId) => AdmittedDispute | undefined
  readonly record: (dispute: AdmittedDispute) => void
}>

const failure = (_tag: ArbitrationFailure['_tag'], reason: string): ArbitrationFailure => ({
  _tag,
  reason,
})

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
const field = (value: string): Uint8Array =>
  new TextEncoder().encode(String(value.length) + ':' + value)
const disputeBytes = (bundle: DisputeBundle): Uint8Array =>
  new Uint8Array([
    ...field(bundle.disputeId),
    ...field(bundle.original.jobId),
    ...field(bundle.original.termsHash),
    ...field(bundle.original.artifactHash),
    ...field(bundle.original.verificationHash),
    ...field(bundle.statement),
  ])
export const hashDisputeBundle = (bundle: DisputeBundle): DisputeHash =>
  DisputeHash(hex(hashProtocolBytes(disputeBytes(bundle))))

export const encodeArbitrationRuling = (ruling: SignedArbitrationRuling): Uint8Array =>
  new Uint8Array([
    ...field(ruling.arbitrationTermsHash),
    ...field(ruling.disputeHash),
    ...field(ruling.outcome),
    ...field(ruling.rulingArtifactHash),
    ...field(ruling.rulingVerificationHash),
    ...field(String(ruling.issuedAt)),
  ])

export const createDisputeStore = (): DisputeStore => {
  const disputes = new Map<DisputeId, AdmittedDispute>()
  return {
    find: (disputeId) => disputes.get(disputeId),
    record: (dispute) => disputes.set(dispute.disputeId, dispute),
  }
}

export const disputeBundle = (
  input: Readonly<{
    readonly disputeId: string
    readonly original: FailedOriginalVerification
    readonly statement: string
    readonly submittedAt: number
  }>,
): Effect.Effect<DisputeBundle, ArbitrationFailure> =>
  Number.isSafeInteger(input.submittedAt) &&
  input.submittedAt >= 0 &&
  DisputeId.is(input.disputeId) &&
  DisputeStatement.is(input.statement)
    ? Effect.succeed({
        ...input,
        disputeId: DisputeId(input.disputeId),
        statement: DisputeStatement(input.statement),
      })
    : Effect.fail(failure('invalid-dispute', 'dispute bundle violates its bounded contract'))

export const admitArbitrationRuling = (
  dispute: AdmittedDispute,
  agreement: AgreedTerms,
  ruling: SignedArbitrationRuling,
  now: number,
  verifier: TermsSignatureVerifier,
): Effect.Effect<ArbitrationSettlementIntent, ArbitrationFailure> => {
  if (!Number.isSafeInteger(now) || now < ruling.issuedAt || now - ruling.issuedAt > 60_000)
    return Effect.fail(failure('stale-dispute', 'arbitration ruling is stale'))
  if (
    agreement.terms.jobId === dispute.original.jobId ||
    agreement.termsHash !== ruling.arbitrationTermsHash ||
    hashDisputeBundle(dispute) !== ruling.disputeHash
  )
    return Effect.fail(
      failure(
        'invalid-ruling',
        'ruling is not bound to a distinct arbitration job and admitted dispute',
      ),
    )
  return Effect.mapError(
    verifier.verify({
      bytes: encodeArbitrationRuling(ruling),
      signer: agreement.terms.provider,
      signature: ruling.signature,
    }),
    () => failure('invalid-ruling', 'arbitrator signature is invalid'),
  ).pipe(
    Effect.as({
      arbitrationJobId: agreement.terms.jobId,
      arbitrationTermsHash: agreement.termsHash,
      disputeHash: ruling.disputeHash,
      paymentAuthority: 'arbitration-job-only',
      rulingArtifactHash: ruling.rulingArtifactHash,
      rulingOutcome: ruling.outcome,
      rulingVerificationHash: ruling.rulingVerificationHash,
    }),
  )
}

export const recordArbitrationReceipt = (
  intent: ArbitrationSettlementIntent,
  receipt: PaymentReceipt,
): Effect.Effect<PaymentReceipt, ArbitrationFailure> => {
  const result = createPaymentReceipt(receipt)
  if (
    !result.ok ||
    receipt.termsHash !== intent.arbitrationTermsHash ||
    receipt.artifactHash !== intent.rulingArtifactHash ||
    receipt.verificationHash !== intent.rulingVerificationHash ||
    !receipt.attemptId.startsWith(`${intent.arbitrationJobId}:`) ||
    !receipt.authorizationKey.startsWith(`${intent.arbitrationJobId}:`)
  ) {
    return Effect.fail(
      failure('invalid-ruling', 'receipt is not bound to the separate arbitration settlement'),
    )
  }
  return Effect.succeed(result.value)
}

export const admitDisputeBundle = (
  bundle: DisputeBundle,
  store: DisputeStore,
  now: number,
): Effect.Effect<AdmittedDispute, ArbitrationFailure> => {
  if (!Number.isSafeInteger(now) || now < bundle.submittedAt || now - bundle.submittedAt > 60_000)
    return Effect.fail(failure('stale-dispute', 'dispute bundle is stale'))
  const admitted: AdmittedDispute = { ...bundle, paymentAuthority: 'arbitration-job-only' }
  const previous = store.find(bundle.disputeId)
  if (previous === undefined) {
    store.record(admitted)
    return Effect.succeed(admitted)
  }
  return previous.original.jobId === admitted.original.jobId &&
    previous.original.termsHash === admitted.original.termsHash &&
    previous.original.artifactHash === admitted.original.artifactHash &&
    previous.original.verificationHash === admitted.original.verificationHash &&
    previous.statement === admitted.statement &&
    previous.submittedAt === admitted.submittedAt
    ? Effect.succeed(previous)
    : Effect.fail(
        failure('conflicting-dispute', 'dispute ID is bound to different original evidence'),
      )
}

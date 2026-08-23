import * as Brand from 'effect/Brand'
import * as Effect from 'effect/Effect'

import {
  EvidenceHash,
  JobId,
  type AtomicAmount,
  type NetworkId,
  type WalletDestination,
} from './job-lifecycle.ts'
import {
  TermsHash,
  TermsSignature,
  encodeExactJobTerms,
  type AgreedTerms,
  type TermsSignatureVerifier,
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

export type ArbitrationAttemptId = string & Brand.Brand<'ArbitrationAttemptId'>
export const ArbitrationAttemptId = Brand.refined<ArbitrationAttemptId>(
  (value) => value.trim().length > 0 && new TextEncoder().encode(value).byteLength <= 256,
  () => Brand.error('arbitration attempt ID must be bounded'),
)

export type ArbitrationAuthorizationKey = string & Brand.Brand<'ArbitrationAuthorizationKey'>
export const ArbitrationAuthorizationKey = Brand.refined<ArbitrationAuthorizationKey>(
  (value) => value.trim().length > 0 && new TextEncoder().encode(value).byteLength <= 256,
  () => Brand.error('arbitration authorization key must be bounded'),
)

export type FailedOriginalVerification = Readonly<{
  readonly _tag: 'failed-original-verification'
  readonly artifactHash: EvidenceHash
  readonly jobId: JobId
  readonly termsHash: TermsHash
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

export type ArbitrationVerification = Readonly<{
  readonly _tag: 'failed-arbitration-verification' | 'passed-arbitration-verification'
  readonly artifactHash: EvidenceHash
  readonly jobId: JobId
  readonly termsHash: TermsHash
  readonly verificationHash: EvidenceHash
}>

export type ArbitrationSettlementIntent = Readonly<{
  readonly arbitrationJobId: JobId
  readonly arbitrationTermsHash: TermsHash
  readonly atomicAmount: AtomicAmount
  readonly destination: WalletDestination
  readonly disputeHash: DisputeHash
  readonly network: NetworkId
  readonly paymentAuthority: 'arbitration-job-only'
  readonly requiredReceiptEvidenceSource: 'live-agent-run'
  readonly rulingArtifactHash: EvidenceHash
  readonly rulingOutcome: SignedArbitrationRuling['outcome']
  readonly rulingVerificationHash: EvidenceHash
}>

export type ArbitrationReceiptEvidenceSource = 'live-agent-run' | 'recorded-fixture'

export type ArbitrationReceiptContext = Readonly<{
  readonly attemptId: ArbitrationAttemptId
  readonly authorizationKey: ArbitrationAuthorizationKey
  readonly evidenceSource: ArbitrationReceiptEvidenceSource
  readonly recordedAt: string
  readonly workspace: string
}>

export type ArbitrationReceiptRecordedEvent = PaymentReceipt &
  Readonly<{
    readonly evidenceSource: ArbitrationReceiptEvidenceSource
    readonly jobId: JobId
    readonly recordedAt: string
    readonly schemaVersion: 2
    readonly type: 'receipt.recorded'
    readonly workspace: string
  }>

export type ArbitrationReceiptAdmission = Readonly<{
  readonly event: ArbitrationReceiptRecordedEvent
  readonly outcome: 'accepted' | 'duplicate'
}>

export type ArbitrationFailure = Readonly<{
  readonly _tag:
    | 'conflicting-dispute'
    | 'invalid-dispute'
    | 'invalid-receipt'
    | 'invalid-ruling'
    | 'stale-dispute'
  readonly reason: string
}>
export type DisputeStore = Readonly<{
  readonly find: (disputeId: DisputeId) => AdmittedDispute | undefined
  readonly record: (dispute: AdmittedDispute) => void
}>

export type ArbitrationReceiptStore = Readonly<{
  readonly find: (
    jobId: JobId,
    authorizationKey: ArbitrationAuthorizationKey,
  ) => ArbitrationReceiptRecordedEvent | undefined
  readonly record: (event: ArbitrationReceiptRecordedEvent) => void
}>

const failure = (_tag: ArbitrationFailure['_tag'], reason: string): ArbitrationFailure => ({
  _tag,
  reason,
})

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
const field = (value: string): Uint8Array => {
  const bytes = new TextEncoder().encode(value)
  return new Uint8Array([
    bytes.length >>> 24,
    bytes.length >>> 16,
    bytes.length >>> 8,
    bytes.length,
    ...bytes,
  ])
}
const disputeBytes = (bundle: DisputeBundle): Uint8Array =>
  new Uint8Array([
    ...field(bundle.disputeId),
    ...field(bundle.original.jobId),
    ...field(bundle.original.termsHash),
    ...field(bundle.original.artifactHash),
    ...field(bundle.original.verificationHash),
    ...field(bundle.statement),
    ...field(String(bundle.submittedAt)),
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

export const createArbitrationReceiptStore = (): ArbitrationReceiptStore => {
  const receipts = new Map<
    JobId,
    Map<ArbitrationAuthorizationKey, ArbitrationReceiptRecordedEvent>
  >()
  return {
    find: (jobId, authorizationKey) => receipts.get(jobId)?.get(authorizationKey),
    record: (event) => {
      const byAuthorization =
        receipts.get(event.jobId) ??
        new Map<ArbitrationAuthorizationKey, ArbitrationReceiptRecordedEvent>()
      byAuthorization.set(ArbitrationAuthorizationKey(event.authorizationKey), event)
      receipts.set(event.jobId, byAuthorization)
    },
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasOnlyFields = (value: Record<string, unknown>, fields: readonly string[]): boolean => {
  const allowed = new Set(fields)
  return Object.keys(value).every((key) => allowed.has(key))
}

const decodeFailedOriginal = (value: unknown): FailedOriginalVerification | undefined => {
  if (
    !isRecord(value) ||
    !hasOnlyFields(value, ['_tag', 'artifactHash', 'jobId', 'termsHash', 'verificationHash']) ||
    value['_tag'] !== 'failed-original-verification' ||
    typeof value['artifactHash'] !== 'string' ||
    !EvidenceHash.is(value['artifactHash']) ||
    typeof value['jobId'] !== 'string' ||
    !JobId.is(value['jobId']) ||
    typeof value['termsHash'] !== 'string' ||
    !TermsHash.is(value['termsHash']) ||
    typeof value['verificationHash'] !== 'string' ||
    !EvidenceHash.is(value['verificationHash'])
  ) {
    return undefined
  }
  return {
    _tag: value['_tag'],
    artifactHash: EvidenceHash(value['artifactHash']),
    jobId: JobId(value['jobId']),
    termsHash: TermsHash(value['termsHash']),
    verificationHash: EvidenceHash(value['verificationHash']),
  }
}

const validRuling = (value: unknown): value is SignedArbitrationRuling =>
  isRecord(value) &&
  hasOnlyFields(value, [
    'arbitrationTermsHash',
    'disputeHash',
    'issuedAt',
    'outcome',
    'rulingArtifactHash',
    'rulingVerificationHash',
    'signature',
  ]) &&
  typeof value['arbitrationTermsHash'] === 'string' &&
  TermsHash.is(value['arbitrationTermsHash']) &&
  typeof value['disputeHash'] === 'string' &&
  DisputeHash.is(value['disputeHash']) &&
  typeof value['issuedAt'] === 'number' &&
  Number.isSafeInteger(value['issuedAt']) &&
  value['issuedAt'] >= 0 &&
  (value['outcome'] === 'buyer-prevails' || value['outcome'] === 'provider-prevails') &&
  typeof value['rulingArtifactHash'] === 'string' &&
  EvidenceHash.is(value['rulingArtifactHash']) &&
  typeof value['rulingVerificationHash'] === 'string' &&
  EvidenceHash.is(value['rulingVerificationHash']) &&
  value['signature'] instanceof Uint8Array &&
  TermsSignature.is(value['signature'])

const validArbitrationVerification = (value: unknown): value is ArbitrationVerification =>
  isRecord(value) &&
  hasOnlyFields(value, ['_tag', 'artifactHash', 'jobId', 'termsHash', 'verificationHash']) &&
  (value['_tag'] === 'passed-arbitration-verification' ||
    value['_tag'] === 'failed-arbitration-verification') &&
  typeof value['artifactHash'] === 'string' &&
  EvidenceHash.is(value['artifactHash']) &&
  typeof value['jobId'] === 'string' &&
  JobId.is(value['jobId']) &&
  typeof value['termsHash'] === 'string' &&
  TermsHash.is(value['termsHash']) &&
  typeof value['verificationHash'] === 'string' &&
  EvidenceHash.is(value['verificationHash'])

const equalBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length && left.every((byte, index) => byte === right[index])

const verifyArbitrationAgreement = (
  agreement: AgreedTerms,
  verifier: TermsSignatureVerifier,
): Effect.Effect<void, ArbitrationFailure> =>
  Effect.gen(function* () {
    const canonicalBytes = yield* encodeExactJobTerms(agreement.terms).pipe(
      Effect.mapError(() => failure('invalid-ruling', 'arbitration agreement terms are invalid')),
    )
    if (
      !equalBytes(canonicalBytes, agreement.canonicalBytes) ||
      hex(hashProtocolBytes(canonicalBytes)) !== agreement.termsHash
    ) {
      return yield* Effect.fail(
        failure('invalid-ruling', 'arbitration agreement canonical binding is invalid'),
      )
    }
    yield* verifier
      .verify({
        bytes: canonicalBytes,
        signer: agreement.terms.buyer,
        signature: agreement.buyerSignature,
      })
      .pipe(
        Effect.mapError(() => failure('invalid-ruling', 'arbitration buyer signature is invalid')),
      )
    yield* verifier
      .verify({
        bytes: canonicalBytes,
        signer: agreement.terms.provider,
        signature: agreement.providerSignature,
      })
      .pipe(
        Effect.mapError(() =>
          failure('invalid-ruling', 'arbitration provider signature is invalid'),
        ),
      )
  })

export const disputeBundle = (
  input: Readonly<{
    readonly disputeId: string
    readonly original: unknown
    readonly statement: string
    readonly submittedAt: number
  }>,
): Effect.Effect<DisputeBundle, ArbitrationFailure> => {
  const original = decodeFailedOriginal(input.original)
  return Number.isSafeInteger(input.submittedAt) &&
    input.submittedAt >= 0 &&
    DisputeId.is(input.disputeId) &&
    DisputeStatement.is(input.statement) &&
    original !== undefined
    ? Effect.succeed({
        disputeId: DisputeId(input.disputeId),
        original,
        statement: DisputeStatement(input.statement),
        submittedAt: input.submittedAt,
      })
    : Effect.fail(failure('invalid-dispute', 'dispute bundle violates its bounded contract'))
}

export const admitArbitrationRuling = (
  dispute: AdmittedDispute,
  agreement: AgreedTerms,
  ruling: SignedArbitrationRuling,
  verification: ArbitrationVerification,
  now: number,
  verifier: TermsSignatureVerifier,
): Effect.Effect<ArbitrationSettlementIntent, ArbitrationFailure> =>
  Effect.gen(function* () {
    if (!validRuling(ruling)) {
      return yield* Effect.fail(failure('invalid-ruling', 'arbitration ruling is invalid'))
    }
    if (!Number.isSafeInteger(now) || now < ruling.issuedAt || now - ruling.issuedAt > 60_000) {
      return yield* Effect.fail(failure('stale-dispute', 'arbitration ruling is stale'))
    }
    if (
      agreement.terms.jobId === dispute.original.jobId ||
      agreement.termsHash !== ruling.arbitrationTermsHash ||
      hashDisputeBundle(dispute) !== ruling.disputeHash
    ) {
      return yield* Effect.fail(
        failure(
          'invalid-ruling',
          'ruling is not bound to a distinct arbitration job and admitted dispute',
        ),
      )
    }
    if (
      !validArbitrationVerification(verification) ||
      verification._tag !== 'passed-arbitration-verification' ||
      verification.jobId !== agreement.terms.jobId ||
      verification.termsHash !== agreement.termsHash ||
      verification.artifactHash !== ruling.rulingArtifactHash ||
      verification.verificationHash !== ruling.rulingVerificationHash
    ) {
      return yield* Effect.fail(
        failure('invalid-ruling', 'ruling lacks exact passed arbitration verification'),
      )
    }

    yield* verifyArbitrationAgreement(agreement, verifier)
    yield* verifier
      .verify({
        bytes: encodeArbitrationRuling(ruling),
        signer: agreement.terms.provider,
        signature: ruling.signature,
      })
      .pipe(Effect.mapError(() => failure('invalid-ruling', 'arbitrator signature is invalid')))

    return {
      arbitrationJobId: agreement.terms.jobId,
      arbitrationTermsHash: agreement.termsHash,
      atomicAmount: agreement.terms.price,
      destination: agreement.terms.destination,
      disputeHash: ruling.disputeHash,
      network: agreement.terms.network,
      paymentAuthority: 'arbitration-job-only',
      requiredReceiptEvidenceSource: 'live-agent-run',
      rulingArtifactHash: ruling.rulingArtifactHash,
      rulingOutcome: ruling.outcome,
      rulingVerificationHash: verification.verificationHash,
    }
  })

const validReceiptContext = (context: ArbitrationReceiptContext): boolean => {
  const timestamp = Date.parse(context.recordedAt)
  return (
    ArbitrationAttemptId.is(context.attemptId) &&
    ArbitrationAuthorizationKey.is(context.authorizationKey) &&
    context.workspace.trim().length > 0 &&
    new TextEncoder().encode(context.workspace).byteLength <= 1_024 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(context.recordedAt) &&
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString() === context.recordedAt
  )
}

export const recordArbitrationReceipt = (
  intent: ArbitrationSettlementIntent,
  context: ArbitrationReceiptContext,
  receipt: PaymentReceipt,
): Effect.Effect<ArbitrationReceiptRecordedEvent, ArbitrationFailure> => {
  const result = createPaymentReceipt(receipt)
  if (
    !result.ok ||
    !validReceiptContext(context) ||
    receipt.termsHash !== intent.arbitrationTermsHash ||
    receipt.artifactHash !== intent.rulingArtifactHash ||
    receipt.verificationHash !== intent.rulingVerificationHash ||
    receipt.atomicAmount !== intent.atomicAmount.toString() ||
    receipt.destination !== intent.destination ||
    receipt.network !== intent.network ||
    receipt.attemptId !== context.attemptId ||
    receipt.authorizationKey !== context.authorizationKey
  ) {
    return Effect.fail(
      failure('invalid-receipt', 'receipt is not bound to the separate arbitration settlement'),
    )
  }
  return Effect.succeed({
    ...result.value,
    evidenceSource: context.evidenceSource,
    jobId: intent.arbitrationJobId,
    recordedAt: context.recordedAt,
    schemaVersion: 2,
    type: 'receipt.recorded',
    workspace: context.workspace,
  })
}

const decodeArbitrationReceiptEvent = (
  value: unknown,
): ArbitrationReceiptRecordedEvent | undefined => {
  if (
    !isRecord(value) ||
    !hasOnlyFields(value, [
      'artifactHash',
      'atomicAmount',
      'attemptId',
      'authorizationKey',
      'destination',
      'evidenceSource',
      'jobId',
      'network',
      'recordedAt',
      'schemaVersion',
      'termsHash',
      'transactionHash',
      'type',
      'verificationHash',
      'workspace',
    ]) ||
    typeof value['artifactHash'] !== 'string' ||
    typeof value['atomicAmount'] !== 'string' ||
    typeof value['attemptId'] !== 'string' ||
    !ArbitrationAttemptId.is(value['attemptId']) ||
    typeof value['authorizationKey'] !== 'string' ||
    !ArbitrationAuthorizationKey.is(value['authorizationKey']) ||
    (value['evidenceSource'] !== 'live-agent-run' &&
      value['evidenceSource'] !== 'recorded-fixture') ||
    typeof value['jobId'] !== 'string' ||
    !JobId.is(value['jobId']) ||
    typeof value['destination'] !== 'string' ||
    typeof value['network'] !== 'string' ||
    typeof value['recordedAt'] !== 'string' ||
    value['schemaVersion'] !== 2 ||
    typeof value['termsHash'] !== 'string' ||
    typeof value['transactionHash'] !== 'string' ||
    value['type'] !== 'receipt.recorded' ||
    typeof value['verificationHash'] !== 'string' ||
    typeof value['workspace'] !== 'string'
  ) {
    return undefined
  }
  const context: ArbitrationReceiptContext = {
    attemptId: ArbitrationAttemptId(value['attemptId']),
    authorizationKey: ArbitrationAuthorizationKey(value['authorizationKey']),
    evidenceSource: value['evidenceSource'],
    recordedAt: value['recordedAt'],
    workspace: value['workspace'],
  }
  const receipt = createPaymentReceipt({
    artifactHash: value['artifactHash'],
    atomicAmount: value['atomicAmount'],
    attemptId: value['attemptId'],
    authorizationKey: value['authorizationKey'],
    destination: value['destination'],
    network: value['network'],
    termsHash: value['termsHash'],
    transactionHash: value['transactionHash'],
    verificationHash: value['verificationHash'],
  })
  if (!receipt.ok || !validReceiptContext(context)) return undefined
  return {
    ...receipt.value,
    evidenceSource: context.evidenceSource,
    jobId: JobId(value['jobId']),
    recordedAt: context.recordedAt,
    schemaVersion: 2,
    type: 'receipt.recorded',
    workspace: context.workspace,
  }
}

const receiptMatchesIntent = (
  event: ArbitrationReceiptRecordedEvent,
  intent: ArbitrationSettlementIntent,
): boolean =>
  event.jobId === intent.arbitrationJobId &&
  event.evidenceSource === intent.requiredReceiptEvidenceSource &&
  event.termsHash === intent.arbitrationTermsHash &&
  event.artifactHash === intent.rulingArtifactHash &&
  event.verificationHash === intent.rulingVerificationHash &&
  event.atomicAmount === intent.atomicAmount.toString() &&
  event.destination === intent.destination &&
  event.network === intent.network

const receiptEventsEqual = (
  left: ArbitrationReceiptRecordedEvent,
  right: ArbitrationReceiptRecordedEvent,
): boolean =>
  left.artifactHash === right.artifactHash &&
  left.atomicAmount === right.atomicAmount &&
  left.attemptId === right.attemptId &&
  left.authorizationKey === right.authorizationKey &&
  left.destination === right.destination &&
  left.evidenceSource === right.evidenceSource &&
  left.jobId === right.jobId &&
  left.network === right.network &&
  left.recordedAt === right.recordedAt &&
  left.termsHash === right.termsHash &&
  left.transactionHash === right.transactionHash &&
  left.verificationHash === right.verificationHash &&
  left.workspace === right.workspace

export const admitArbitrationReceiptEvent = (
  intent: ArbitrationSettlementIntent,
  value: unknown,
  store: ArbitrationReceiptStore,
): Effect.Effect<ArbitrationReceiptAdmission, ArbitrationFailure> =>
  Effect.suspend((): Effect.Effect<ArbitrationReceiptAdmission, ArbitrationFailure> => {
    const event = decodeArbitrationReceiptEvent(value)
    if (event === undefined || !receiptMatchesIntent(event, intent)) {
      return Effect.fail(
        failure('invalid-receipt', 'receipt event violates the arbitration settlement binding'),
      )
    }
    const authorizationKey = ArbitrationAuthorizationKey(event.authorizationKey)
    const previous = store.find(event.jobId, authorizationKey)
    if (previous === undefined) {
      store.record(event)
      return Effect.succeed({ event, outcome: 'accepted' })
    }
    return receiptEventsEqual(previous, event)
      ? Effect.succeed({ event: previous, outcome: 'duplicate' })
      : Effect.fail(
          failure('invalid-receipt', 'arbitration authorization has conflicting receipt evidence'),
        )
  })

export const admitDisputeBundle = (
  bundle: DisputeBundle,
  store: DisputeStore,
  now: number,
): Effect.Effect<AdmittedDispute, ArbitrationFailure> =>
  Effect.suspend(() => {
    if (
      !Number.isSafeInteger(now) ||
      now < bundle.submittedAt ||
      now - bundle.submittedAt > 60_000
    ) {
      return Effect.fail(failure('stale-dispute', 'dispute bundle is stale'))
    }
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
  })

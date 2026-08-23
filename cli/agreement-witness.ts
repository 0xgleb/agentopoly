import { createHash, createPublicKey, verify } from 'node:crypto'

import * as Effect from 'effect/Effect'

import {
  type ExactJobTerms,
  ServiceId,
  TermsHash,
  TokenContract,
  encodeExactJobTerms,
} from '../economy/exact-job-terms.ts'
import {
  AtomicAmount,
  EvidenceHash,
  JobId,
  NetworkId,
  ParticipantId,
  WalletDestination,
} from '../economy/job-lifecycle.ts'
import { hashProtocolBytes } from '../protocol/envelope-boundary.ts'

export type AgreementWitnessTerms = Readonly<{
  readonly acceptanceContractHash: string
  readonly artifactContractHash: string
  readonly asset: 'USDt'
  readonly bidExpiry: number
  readonly buyer: string
  readonly buyerWallet: string
  readonly decimals: 6
  readonly destination: string
  readonly executionDeadline: number
  readonly jobId: string
  readonly maximumNativeFee: string
  readonly network: string
  readonly price: string
  readonly provider: string
  readonly serviceId: string
  readonly taskInputHash: string
  readonly tokenContract: string
}>

export type AgreementWitnessInput = Readonly<{
  readonly buyerSignature: string
  readonly operatorKeyId: string
  readonly operatorSignature: string
  readonly providerSignature: string
  readonly schemaVersion: 1
  readonly terms: AgreementWitnessTerms
  readonly termsHash: string
  readonly workspace: string
}>

export type SignedAgreementWitness = Readonly<{
  readonly buyerSignature: string
  readonly operatorKeyId: string
  readonly payment: Readonly<{
    readonly asset: 'USDt'
    readonly atomicAmount: string
    readonly destination: string
    readonly maximumNativeFee: string
    readonly network: string
    readonly token: 'usdt'
  }>
  readonly providerSignature: string
  readonly terms: AgreementWitnessTerms
  readonly termsHash: string
  readonly workspace: string
}>

export type AgreementWitnessFailure = Readonly<{
  readonly _tag:
    | 'agreement-witness-signature-invalid'
    | 'agreement-witness-verification-mismatch'
    | 'agreement-witness-workspace-mismatch'
    | 'invalid-agreement-witness'
  readonly reason: string
}>

const failure = (
  _tag: AgreementWitnessFailure['_tag'],
  reason: string,
): AgreementWitnessFailure => ({ _tag, reason })

const utf8Length = (value: string): number => new TextEncoder().encode(value).byteLength

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isBoundedIdentifier = (value: unknown, maximumLength = 256): value is string =>
  typeof value === 'string' && value.trim().length > 0 && utf8Length(value) <= maximumLength

const isHash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

const isPositiveAtomic = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && value.length <= 78

const isBase64 = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1_368) return false
  try {
    const decoded = Buffer.from(value, 'base64')
    return decoded.length > 0 && decoded.length <= 1_024 && decoded.toString('base64') === value
  } catch {
    return false
  }
}

const only = (value: Record<string, unknown>, fields: readonly string[]): boolean => {
  const allowed = new Set(fields)
  return Object.keys(value).every((key) => allowed.has(key))
}

const hex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')

const join = (parts: readonly Uint8Array[]): Uint8Array => {
  const length = parts.reduce((total, part) => total + part.length, 0)
  const joined = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    joined.set(part, offset)
    offset += part.length
  }
  return joined
}

const u32 = (value: number): Uint8Array =>
  Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value & 255)

const field = (value: string): Uint8Array => {
  const encoded = new TextEncoder().encode(value)
  return join([u32(encoded.length), encoded])
}

const decodeTerms = (
  value: unknown,
): Effect.Effect<AgreementWitnessTerms, AgreementWitnessFailure> => {
  if (!isRecord(value)) {
    return Effect.fail(failure('invalid-agreement-witness', 'agreement terms are invalid'))
  }
  const bidExpiry = value['bidExpiry']
  const executionDeadline = value['executionDeadline']
  if (
    !only(value, [
      'acceptanceContractHash',
      'artifactContractHash',
      'asset',
      'bidExpiry',
      'buyer',
      'buyerWallet',
      'decimals',
      'destination',
      'executionDeadline',
      'jobId',
      'maximumNativeFee',
      'network',
      'price',
      'provider',
      'serviceId',
      'taskInputHash',
      'tokenContract',
    ]) ||
    !isHash(value['acceptanceContractHash']) ||
    !isHash(value['artifactContractHash']) ||
    value['asset'] !== 'USDt' ||
    typeof bidExpiry !== 'number' ||
    !Number.isSafeInteger(bidExpiry) ||
    bidExpiry < 0 ||
    !isBoundedIdentifier(value['buyer']) ||
    !isBoundedIdentifier(value['buyerWallet']) ||
    value['decimals'] !== 6 ||
    !isBoundedIdentifier(value['destination']) ||
    typeof executionDeadline !== 'number' ||
    !Number.isSafeInteger(executionDeadline) ||
    executionDeadline < bidExpiry ||
    !isBoundedIdentifier(value['jobId']) ||
    !isPositiveAtomic(value['maximumNativeFee']) ||
    !isBoundedIdentifier(value['network'], 128) ||
    !isPositiveAtomic(value['price']) ||
    !isBoundedIdentifier(value['provider']) ||
    !isBoundedIdentifier(value['serviceId']) ||
    !isHash(value['taskInputHash']) ||
    !isBoundedIdentifier(value['tokenContract'])
  ) {
    return Effect.fail(failure('invalid-agreement-witness', 'agreement terms are invalid'))
  }

  return Effect.succeed({
    acceptanceContractHash: value['acceptanceContractHash'],
    artifactContractHash: value['artifactContractHash'],
    asset: 'USDt',
    bidExpiry,
    buyer: value['buyer'],
    buyerWallet: value['buyerWallet'],
    decimals: 6,
    destination: value['destination'],
    executionDeadline,
    jobId: value['jobId'],
    maximumNativeFee: value['maximumNativeFee'],
    network: value['network'],
    price: value['price'],
    provider: value['provider'],
    serviceId: value['serviceId'],
    taskInputHash: value['taskInputHash'],
    tokenContract: value['tokenContract'],
  })
}

const asExactJobTerms = (terms: AgreementWitnessTerms): ExactJobTerms => ({
  acceptanceContractHash: EvidenceHash(terms.acceptanceContractHash),
  artifactContractHash: EvidenceHash(terms.artifactContractHash),
  asset: 'USDt',
  bidExpiry: terms.bidExpiry,
  buyer: ParticipantId(terms.buyer),
  buyerWallet: WalletDestination(terms.buyerWallet),
  decimals: 6,
  destination: WalletDestination(terms.destination),
  executionDeadline: terms.executionDeadline,
  jobId: JobId(terms.jobId),
  maximumNativeFee: AtomicAmount(BigInt(terms.maximumNativeFee)),
  network: NetworkId(terms.network),
  price: AtomicAmount(BigInt(terms.price)),
  provider: ParticipantId(terms.provider),
  serviceId: ServiceId(terms.serviceId),
  taskInputHash: EvidenceHash(terms.taskInputHash),
  tokenContract: TokenContract(terms.tokenContract),
})

export const deriveAgreementTermsHash = (
  terms: AgreementWitnessTerms,
): Effect.Effect<string, AgreementWitnessFailure> =>
  Effect.flatMap(decodeTerms(terms), (decodedTerms) =>
    Effect.mapError(
      Effect.map(encodeExactJobTerms(asExactJobTerms(decodedTerms)), (bytes) =>
        hex(hashProtocolBytes(bytes)),
      ),
      () => failure('invalid-agreement-witness', 'agreement terms cannot be encoded canonically'),
    ),
  )

export const encodeAgreementWitnessAttestation = (
  input: Omit<AgreementWitnessInput, 'operatorSignature'>,
): Effect.Effect<Uint8Array, AgreementWitnessFailure> =>
  Effect.gen(function* () {
    const terms = yield* decodeTerms(input.terms)
    const termsBytes = yield* Effect.mapError(encodeExactJobTerms(asExactJobTerms(terms)), () =>
      failure('invalid-agreement-witness', 'agreement terms cannot be encoded canonically'),
    )
    if (
      !isBoundedIdentifier(input.workspace, 1_024) ||
      !isBoundedIdentifier(input.operatorKeyId) ||
      !isBase64(input.buyerSignature) ||
      !isBase64(input.providerSignature) ||
      !isHash(input.termsHash)
    ) {
      return yield* Effect.fail(
        failure('invalid-agreement-witness', 'agreement witness attestation fields are invalid'),
      )
    }
    return join([
      Uint8Array.of(1),
      field(input.workspace),
      termsBytes,
      field(input.termsHash),
      field(input.buyerSignature),
      field(input.providerSignature),
      field(input.operatorKeyId),
    ])
  })

export const decodeSignedAgreementWitness = (
  text: string,
  input: Readonly<{ readonly expectedWorkspace: string; readonly operatorPublicKey: string }>,
): Effect.Effect<SignedAgreementWitness, AgreementWitnessFailure> =>
  Effect.gen(function* () {
    const decoded = yield* Effect.try({
      try: (): unknown => JSON.parse(text),
      catch: () => failure('invalid-agreement-witness', 'agreement witness is not valid JSON'),
    })
    if (
      !isRecord(decoded) ||
      !only(decoded, [
        'buyerSignature',
        'operatorKeyId',
        'operatorSignature',
        'providerSignature',
        'schemaVersion',
        'terms',
        'termsHash',
        'workspace',
      ]) ||
      decoded['schemaVersion'] !== 1 ||
      !isBoundedIdentifier(decoded['workspace'], 1_024) ||
      !isBoundedIdentifier(decoded['operatorKeyId']) ||
      !isBase64(decoded['buyerSignature']) ||
      !isBase64(decoded['providerSignature']) ||
      !isBase64(decoded['operatorSignature']) ||
      !isHash(decoded['termsHash'])
    ) {
      return yield* Effect.fail(
        failure('invalid-agreement-witness', 'agreement witness has an invalid shape'),
      )
    }
    if (decoded['workspace'] !== input.expectedWorkspace) {
      return yield* Effect.fail(
        failure(
          'agreement-witness-workspace-mismatch',
          'agreement witness belongs to another workspace',
        ),
      )
    }
    const buyerSignature = decoded['buyerSignature']
    const operatorKeyId = decoded['operatorKeyId']
    const operatorSignature = decoded['operatorSignature']
    const providerSignature = decoded['providerSignature']
    const termsHash = decoded['termsHash']
    const workspace = decoded['workspace']
    if (
      !isBase64(buyerSignature) ||
      !isBoundedIdentifier(operatorKeyId) ||
      !isBase64(operatorSignature) ||
      !isBase64(providerSignature) ||
      !isHash(termsHash) ||
      !isBoundedIdentifier(workspace, 1_024)
    ) {
      return yield* Effect.fail(
        failure('invalid-agreement-witness', 'agreement witness changed during decoding'),
      )
    }
    const unsigned = {
      buyerSignature,
      operatorKeyId,
      providerSignature,
      schemaVersion: 1 as const,
      terms: yield* decodeTerms(decoded['terms']),
      termsHash,
      workspace,
    }
    const bytes = yield* encodeAgreementWitnessAttestation(unsigned)
    const signatureValid = yield* Effect.try({
      try: () =>
        verify(
          null,
          bytes,
          createPublicKey(input.operatorPublicKey),
          Buffer.from(operatorSignature, 'base64'),
        ),
      catch: () =>
        failure(
          'agreement-witness-signature-invalid',
          'agreement witness operator signature cannot be verified',
        ),
    })
    if (!signatureValid) {
      return yield* Effect.fail(
        failure(
          'agreement-witness-signature-invalid',
          'agreement witness operator signature is invalid',
        ),
      )
    }
    const derivedTermsHash = yield* deriveAgreementTermsHash(unsigned.terms)
    if (derivedTermsHash !== unsigned.termsHash || !TermsHash.is(derivedTermsHash)) {
      return yield* Effect.fail(
        failure('invalid-agreement-witness', 'agreement witness terms hash is not canonical'),
      )
    }
    return {
      buyerSignature: unsigned.buyerSignature,
      operatorKeyId: unsigned.operatorKeyId,
      payment: {
        asset: 'USDt',
        atomicAmount: unsigned.terms.price,
        destination: unsigned.terms.destination,
        maximumNativeFee: unsigned.terms.maximumNativeFee,
        network: unsigned.terms.network,
        token: 'usdt',
      },
      providerSignature: unsigned.providerSignature,
      terms: unsigned.terms,
      termsHash: derivedTermsHash,
      workspace: unsigned.workspace,
    }
  })

export const agreementWitnessFileName = (workspace: string): string =>
  `${createHash('sha256').update(workspace, 'utf8').digest('hex')}.json`

export const bindAgreementWitnessToVerification = (
  witness: SignedAgreementWitness,
  verification: Readonly<{
    readonly artifactHash: string
    readonly passed: boolean
    readonly termsHash: string
    readonly verificationHash: string
  }>,
): Effect.Effect<SignedAgreementWitness['payment'], AgreementWitnessFailure> => {
  if (
    !isHash(verification.artifactHash) ||
    !isHash(verification.verificationHash) ||
    !verification.passed ||
    witness.termsHash !== verification.termsHash
  ) {
    return Effect.fail(
      failure(
        'agreement-witness-verification-mismatch',
        'agreement witness does not bind the passed live verification',
      ),
    )
  }
  return Effect.succeed(witness.payment)
}

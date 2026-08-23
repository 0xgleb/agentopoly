import { describe, expect, test } from 'bun:test'

import * as Effect from 'effect/Effect'

import { EvidenceHash, JobId } from '../../economy/job-lifecycle.ts'
import {
  admitArbitrationRuling,
  admitDisputeBundle,
  createDisputeStore,
  disputeBundle,
  hashDisputeBundle,
  recordArbitrationReceipt,
  type FailedOriginalVerification,
} from '../../economy/paid-arbitration.ts'
import {
  ServiceId,
  TermsHash,
  TermsSignature,
  TokenContract,
  type AgreedTerms,
  type TermsSignatureVerifier,
} from '../../economy/exact-job-terms.ts'
import {
  AtomicAmount,
  NetworkId,
  ParticipantId,
  WalletDestination,
} from '../../economy/job-lifecycle.ts'

const hash = (value: string) => EvidenceHash(value.repeat(64))

const failedOriginal: FailedOriginalVerification = {
  _tag: 'failed-original-verification',
  artifactHash: hash('a'),
  jobId: JobId('job-1'),
  termsHash: hash('b'),
  verificationHash: hash('c'),
}

const verifier: TermsSignatureVerifier = { verify: () => Effect.void }

const arbitrationAgreement = (jobId = 'arbitration-job'): AgreedTerms => ({
  buyerSignature: TermsSignature(Uint8Array.of(1)),
  canonicalBytes: Uint8Array.of(1),
  providerSignature: TermsSignature(Uint8Array.of(2)),
  terms: {
    acceptanceContractHash: hash('d'),
    artifactContractHash: hash('e'),
    asset: 'USDt',
    bidExpiry: 200,
    buyer: ParticipantId('buyer'),
    buyerWallet: WalletDestination('buyer-wallet'),
    decimals: 6,
    destination: WalletDestination('arbitrator-wallet'),
    executionDeadline: 300,
    jobId: JobId(jobId),
    maximumNativeFee: AtomicAmount(1n),
    network: NetworkId('network'),
    price: AtomicAmount(1n),
    provider: ParticipantId('arbitrator'),
    serviceId: ServiceId('arbitration'),
    taskInputHash: hash('f'),
    tokenContract: TokenContract('usdt'),
  },
  termsHash: TermsHash('d'.repeat(64)),
})

const admit = (statement = 'artifact violates the fixed acceptance contract') =>
  Effect.runSync(
    Effect.flatMap(
      disputeBundle({
        disputeId: 'dispute-1',
        original: failedOriginal,
        statement,
        submittedAt: 100,
      }),
      (bundle) => admitDisputeBundle(bundle, createDisputeStore(), 100),
    ),
  )

describe('paid arbitration dispute boundary', () => {
  test('admits one failed-original bundle with arbitration-only authority', () => {
    expect(admit()).toMatchObject({ paymentAuthority: 'arbitration-job-only' })
  })

  test('accepts a signed ruling only for a distinct arbitration agreement and bound dispute', () => {
    const dispute = Effect.runSync(
      Effect.flatMap(
        disputeBundle({
          disputeId: 'dispute-2',
          original: failedOriginal,
          statement: 'missing acceptance proof',
          submittedAt: 100,
        }),
        (bundle) => admitDisputeBundle(bundle, createDisputeStore(), 100),
      ),
    )
    const agreement = arbitrationAgreement()
    const ruling = {
      arbitrationTermsHash: agreement.termsHash,
      disputeHash: hashDisputeBundle(dispute),
      issuedAt: 100,
      outcome: 'buyer-prevails' as const,
      rulingArtifactHash: hash('e'),
      rulingVerificationHash: hash('f'),
      signature: TermsSignature(Uint8Array.of(9)),
    }
    expect(
      Effect.runSync(admitArbitrationRuling(dispute, agreement, ruling, 100, verifier)),
    ).toMatchObject({
      arbitrationJobId: JobId('arbitration-job'),
      paymentAuthority: 'arbitration-job-only',
    })
    const intent = Effect.runSync(admitArbitrationRuling(dispute, agreement, ruling, 100, verifier))
    expect(
      Effect.runSync(
        recordArbitrationReceipt(intent, {
          artifactHash: ruling.rulingArtifactHash,
          atomicAmount: '1',
          attemptId: 'arbitration-job:attempt-1',
          authorizationKey: 'arbitration-job:authorization-1',
          destination: 'arbitrator-wallet',
          network: 'network',
          termsHash: agreement.termsHash,
          transactionHash: 'a'.repeat(64),
          verificationHash: ruling.rulingVerificationHash,
        }),
      ),
    ).toMatchObject({ termsHash: agreement.termsHash })
    expect(() =>
      Effect.runSync(
        admitArbitrationRuling(dispute, arbitrationAgreement('job-1'), ruling, 100, verifier),
      ),
    ).toThrow()
    expect(() =>
      Effect.runSync(
        admitArbitrationRuling(dispute, agreement, { ...ruling, issuedAt: 0 }, 70_000, verifier),
      ),
    ).toThrow()
  })

  test('refuses stale, malformed, and conflicting replay bundles', () => {
    expect(() => admit('')).toThrow()
    expect(() =>
      Effect.runSync(
        Effect.flatMap(
          disputeBundle({
            disputeId: 'dispute-1',
            original: failedOriginal,
            statement: 'x',
            submittedAt: 0,
          }),
          (bundle) => admitDisputeBundle(bundle, createDisputeStore(), 70_000),
        ),
      ),
    ).toThrow()
    const store = createDisputeStore()
    const first = Effect.runSync(
      disputeBundle({
        disputeId: 'dispute-1',
        original: failedOriginal,
        statement: 'x',
        submittedAt: 100,
      }),
    )
    Effect.runSync(admitDisputeBundle(first, store, 100))
    const conflicting = Effect.runSync(
      disputeBundle({
        disputeId: 'dispute-1',
        original: { ...failedOriginal, artifactHash: hash('d') },
        statement: 'x',
        submittedAt: 100,
      }),
    )
    expect(() => Effect.runSync(admitDisputeBundle(conflicting, store, 100))).toThrow()
  })
})

import { describe, expect, test } from 'bun:test'

import * as Effect from 'effect/Effect'

import {
  ServiceId,
  TermsHash,
  TermsSignature,
  TokenContract,
  agreeExactJobTerms,
  type AgreedTerms,
  type ExactJobTerms,
  type TermsSignatureVerifier,
} from '../../economy/exact-job-terms.ts'
import {
  AtomicAmount,
  EvidenceHash,
  JobId,
  NetworkId,
  ParticipantId,
  WalletDestination,
} from '../../economy/job-lifecycle.ts'
import {
  ArbitrationAttemptId,
  ArbitrationAuthorizationKey,
  DisputeId,
  DisputeStatement,
  admitArbitrationReceiptEvent,
  admitArbitrationRuling,
  admitDisputeBundle,
  createArbitrationReceiptStore,
  createDisputeStore,
  disputeBundle,
  hashDisputeBundle,
  recordArbitrationReceipt,
  type ArbitrationFailure,
  type ArbitrationVerification,
  type FailedOriginalVerification,
  type SignedArbitrationRuling,
} from '../../economy/paid-arbitration.ts'

const hash = (value: string): EvidenceHash => EvidenceHash(value.repeat(64))

const failedOriginal: FailedOriginalVerification = {
  _tag: 'failed-original-verification',
  artifactHash: hash('a'),
  jobId: JobId('job-1'),
  termsHash: TermsHash('b'.repeat(64)),
  verificationHash: hash('c'),
}

const verifier: TermsSignatureVerifier = { verify: () => Effect.void }
const rejectingRulingVerifier: TermsSignatureVerifier = {
  verify: ({ signature }) =>
    signature.at(0) === 9
      ? Effect.fail({ _tag: 'signature-invalid', reason: 'fixture rejected the ruling signature' })
      : Effect.void,
}

const arbitrationAgreement = (jobId = 'arbitration-job'): AgreedTerms => {
  const terms: ExactJobTerms = {
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
    price: AtomicAmount(7n),
    provider: ParticipantId('arbitrator'),
    serviceId: ServiceId('arbitration'),
    taskInputHash: hash('f'),
    tokenContract: TokenContract('usdt'),
  }
  return Effect.runSync(
    agreeExactJobTerms(
      terms,
      [
        { signer: terms.buyer, signature: TermsSignature(Uint8Array.of(1)) },
        { signer: terms.provider, signature: TermsSignature(Uint8Array.of(2)) },
      ],
      100,
      verifier,
    ),
  )
}

const admit = (
  statement = 'artifact violates the fixed acceptance contract',
  submittedAt = 100,
  store = createDisputeStore(),
) =>
  Effect.runSync(
    Effect.flatMap(
      disputeBundle({
        disputeId: 'dispute-1',
        original: failedOriginal,
        statement,
        submittedAt,
      }),
      (bundle) => admitDisputeBundle(bundle, store, submittedAt),
    ),
  )

const refusalOf = <A>(
  effect: Effect.Effect<A, ArbitrationFailure>,
): ArbitrationFailure['_tag'] | 'unexpected-success' => {
  const result = Effect.runSync(Effect.either(effect))
  return result._tag === 'Left' ? result.left._tag : 'unexpected-success'
}

const rulingFor = (
  agreement: AgreedTerms,
  disputeHash: ReturnType<typeof hashDisputeBundle>,
): SignedArbitrationRuling => ({
  arbitrationTermsHash: agreement.termsHash,
  disputeHash,
  issuedAt: 100,
  outcome: 'buyer-prevails',
  rulingArtifactHash: hash('e'),
  rulingVerificationHash: hash('f'),
  signature: TermsSignature(Uint8Array.of(9)),
})

const passedVerificationFor = (
  agreement: AgreedTerms,
  ruling: SignedArbitrationRuling,
): ArbitrationVerification => ({
  _tag: 'passed-arbitration-verification',
  artifactHash: ruling.rulingArtifactHash,
  jobId: agreement.terms.jobId,
  termsHash: agreement.termsHash,
  verificationHash: hash('f'),
})

describe('paid arbitration dispute boundary', () => {
  test('defers admission and binds submission time into one replay hash', () => {
    const store = createDisputeStore()
    const bundle = Effect.runSync(
      disputeBundle({
        disputeId: 'dispute-1',
        original: failedOriginal,
        statement: 'artifact violates the fixed acceptance contract',
        submittedAt: 100,
      }),
    )
    const admission = admitDisputeBundle(bundle, store, 100)
    expect(store.find(bundle.disputeId)).toBeUndefined()
    const first = Effect.runSync(admission)
    expect(store.find(bundle.disputeId)).toBe(first)
    const duplicate = Effect.runSync(admitDisputeBundle(first, store, first.submittedAt))
    expect(duplicate).toBe(first)
    expect(hashDisputeBundle(first)).not.toBe(hashDisputeBundle(admit(undefined, 101)))
  })

  test('creates an arbitration-only intent after signed ruling and passed ruling verification', () => {
    const dispute = admit()
    const agreement = arbitrationAgreement()
    const ruling = rulingFor(agreement, hashDisputeBundle(dispute))
    const verification = passedVerificationFor(agreement, ruling)
    const intent = Effect.runSync(
      admitArbitrationRuling(dispute, agreement, ruling, verification, 100, verifier),
    )

    expect(intent).toMatchObject({
      arbitrationJobId: JobId('arbitration-job'),
      atomicAmount: AtomicAmount(7n),
      destination: WalletDestination('arbitrator-wallet'),
      network: NetworkId('network'),
      paymentAuthority: 'arbitration-job-only',
      rulingVerificationHash: verification.verificationHash,
    })

    const event = Effect.runSync(
      recordArbitrationReceipt(
        intent,
        {
          attemptId: ArbitrationAttemptId('arbitration-attempt-1'),
          authorizationKey: ArbitrationAuthorizationKey('arbitration-authorization-1'),
          evidenceSource: 'live-agent-run',
          recordedAt: '2026-08-23T08:00:00.000Z',
          workspace: 'arbitration-workspace',
        },
        {
          artifactHash: ruling.rulingArtifactHash,
          atomicAmount: '7',
          attemptId: 'arbitration-attempt-1',
          authorizationKey: 'arbitration-authorization-1',
          destination: 'arbitrator-wallet',
          network: 'network',
          termsHash: agreement.termsHash,
          transactionHash: 'a'.repeat(64),
          verificationHash: verification.verificationHash,
        },
      ),
    )
    expect(event).toMatchObject({
      evidenceSource: 'live-agent-run',
      jobId: 'arbitration-job',
      schemaVersion: 2,
      type: 'receipt.recorded',
      workspace: 'arbitration-workspace',
    })
    const receipts = createArbitrationReceiptStore()
    expect(Effect.runSync(admitArbitrationReceiptEvent(intent, event, receipts))).toMatchObject({
      event,
      outcome: 'accepted',
    })
    expect(Effect.runSync(admitArbitrationReceiptEvent(intent, event, receipts))).toMatchObject({
      event,
      outcome: 'duplicate',
    })
  })

  test('refuses stale, malformed, duplicate-conflicting, and runtime-invalid dispute bundles', () => {
    expect(() => admit('')).toThrow()
    expect(() =>
      Effect.runSync(
        disputeBundle({
          disputeId: 'dispute-1',
          original: { ...failedOriginal, _tag: 'not-a-verification' },
          statement: 'x',
          submittedAt: 100,
        }),
      ),
    ).toThrow()
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
    expect(Effect.runSync(admitDisputeBundle(first, store, 100))).toEqual(
      Effect.runSync(admitDisputeBundle(first, store, 100)),
    )
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

  test('refuses unsigned, stale, original-job, failed, and cross-job ruling evidence', () => {
    const dispute = admit()
    const agreement = arbitrationAgreement()
    const ruling = rulingFor(agreement, hashDisputeBundle(dispute))
    const passed = passedVerificationFor(agreement, ruling)

    expect(() =>
      Effect.runSync(
        admitArbitrationRuling(dispute, agreement, ruling, passed, 100, rejectingRulingVerifier),
      ),
    ).toThrow()
    expect(() =>
      Effect.runSync(
        admitArbitrationRuling(
          dispute,
          { ...agreement, canonicalBytes: Uint8Array.of(0) },
          ruling,
          passed,
          100,
          verifier,
        ),
      ),
    ).toThrow()
    const rulingWithUnknown = { ...ruling, unknownField: 'unsigned' }
    expect(
      refusalOf(
        admitArbitrationRuling(dispute, agreement, rulingWithUnknown, passed, 100, verifier),
      ),
    ).toBe('invalid-ruling')
    const verificationWithUnknown = { ...passed, unknownField: 'unsigned' }
    expect(
      refusalOf(
        admitArbitrationRuling(dispute, agreement, ruling, verificationWithUnknown, 100, verifier),
      ),
    ).toBe('invalid-ruling')
    expect(() =>
      Effect.runSync(
        admitArbitrationRuling(
          dispute,
          agreement,
          { ...ruling, issuedAt: 0 },
          passed,
          70_000,
          verifier,
        ),
      ),
    ).toThrow()
    expect(() =>
      Effect.runSync(
        admitArbitrationRuling(
          dispute,
          arbitrationAgreement('job-1'),
          ruling,
          passed,
          100,
          verifier,
        ),
      ),
    ).toThrow()
    expect(() =>
      Effect.runSync(
        admitArbitrationRuling(
          dispute,
          agreement,
          ruling,
          { ...passed, _tag: 'failed-arbitration-verification' },
          100,
          verifier,
        ),
      ),
    ).toThrow()
    const mismatchedVerifications: readonly ArbitrationVerification[] = [
      { ...passed, jobId: JobId('another-arbitration-job') },
      { ...passed, termsHash: TermsHash('1'.repeat(64)) },
      { ...passed, artifactHash: hash('2') },
      { ...passed, verificationHash: hash('3') },
    ]
    for (const mismatch of mismatchedVerifications) {
      expect(() =>
        Effect.runSync(admitArbitrationRuling(dispute, agreement, ruling, mismatch, 100, verifier)),
      ).toThrow()
    }
  })

  test('refuses a ruling signed for a different dispute', () => {
    const dispute = admit()
    const other = admit('a different bounded dispute statement')
    const agreement = arbitrationAgreement()
    const ruling = rulingFor(agreement, hashDisputeBundle(other))
    const verification = passedVerificationFor(agreement, ruling)
    expect(
      refusalOf(admitArbitrationRuling(dispute, agreement, ruling, verification, 100, verifier)),
    ).toBe('invalid-ruling')
  })

  test('enforces the exact UTF-8 bounds for dispute and receipt identifiers', () => {
    expect(DisputeId('d'.repeat(256))).toHaveLength(256)
    expect(() => DisputeId('d'.repeat(257))).toThrow()
    expect(DisputeStatement('s'.repeat(4_096))).toHaveLength(4_096)
    expect(() => DisputeStatement('s'.repeat(4_097))).toThrow()
    expect(ArbitrationAttemptId('a'.repeat(256))).toHaveLength(256)
    expect(() => ArbitrationAttemptId('a'.repeat(257))).toThrow()
    expect(ArbitrationAuthorizationKey('k'.repeat(256))).toHaveLength(256)
    expect(() => ArbitrationAuthorizationKey('k'.repeat(257))).toThrow()
  })

  test('refuses every mismatched arbitration receipt witness before producing a v2 event', () => {
    const dispute = admit()
    const agreement = arbitrationAgreement()
    const ruling = rulingFor(agreement, hashDisputeBundle(dispute))
    const verification = passedVerificationFor(agreement, ruling)
    const intent = Effect.runSync(
      admitArbitrationRuling(dispute, agreement, ruling, verification, 100, verifier),
    )
    const context = {
      attemptId: ArbitrationAttemptId('arbitration-attempt-1'),
      authorizationKey: ArbitrationAuthorizationKey('arbitration-authorization-1'),
      evidenceSource: 'live-agent-run',
      recordedAt: '2026-08-23T08:00:00.000Z',
      workspace: 'arbitration-workspace',
    } as const
    const receipt = {
      artifactHash: ruling.rulingArtifactHash,
      atomicAmount: '7',
      attemptId: context.attemptId,
      authorizationKey: context.authorizationKey,
      destination: 'arbitrator-wallet',
      network: 'network',
      termsHash: agreement.termsHash,
      transactionHash: 'a'.repeat(64),
      verificationHash: verification.verificationHash,
    }
    const mismatches = [
      { ...receipt, atomicAmount: '8' },
      { ...receipt, destination: 'provider-wallet' },
      { ...receipt, network: 'another-network' },
      { ...receipt, attemptId: 'another-attempt' },
      { ...receipt, authorizationKey: 'another-authorization' },
      { ...receipt, termsHash: '1'.repeat(64) },
      { ...receipt, artifactHash: '2'.repeat(64) },
      { ...receipt, verificationHash: '3'.repeat(64) },
    ]

    for (const mismatch of mismatches) {
      expect(refusalOf(recordArbitrationReceipt(intent, context, mismatch))).toBe('invalid-receipt')
    }
    expect(
      refusalOf(
        recordArbitrationReceipt(intent, { ...context, recordedAt: 'not-an-instant' }, receipt),
      ),
    ).toBe('invalid-receipt')
    expect(
      refusalOf(recordArbitrationReceipt(intent, { ...context, workspace: '' }, receipt)),
    ).toBe('invalid-receipt')
    expect(
      Effect.runSync(
        recordArbitrationReceipt(intent, { ...context, workspace: 'w'.repeat(1_024) }, receipt),
      ).workspace,
    ).toHaveLength(1_024)
    expect(
      refusalOf(
        recordArbitrationReceipt(intent, { ...context, workspace: 'w'.repeat(1_025) }, receipt),
      ),
    ).toBe('invalid-receipt')

    const fixtureEvent = Effect.runSync(
      recordArbitrationReceipt(intent, { ...context, evidenceSource: 'recorded-fixture' }, receipt),
    )
    expect(fixtureEvent.evidenceSource).toBe('recorded-fixture')
    expect(
      refusalOf(
        admitArbitrationReceiptEvent(intent, fixtureEvent, createArbitrationReceiptStore()),
      ),
    ).toBe('invalid-receipt')

    const liveEvent = Effect.runSync(recordArbitrationReceipt(intent, context, receipt))
    expect(
      refusalOf(
        admitArbitrationReceiptEvent(
          intent,
          { ...liveEvent, unknownField: 'unsigned' },
          createArbitrationReceiptStore(),
        ),
      ),
    ).toBe('invalid-receipt')
    const receipts = createArbitrationReceiptStore()
    expect(Effect.runSync(admitArbitrationReceiptEvent(intent, liveEvent, receipts)).outcome).toBe(
      'accepted',
    )
    expect(
      refusalOf(
        admitArbitrationReceiptEvent(
          intent,
          { ...liveEvent, transactionHash: 'b'.repeat(64) },
          receipts,
        ),
      ),
    ).toBe('invalid-receipt')
  })
})

import { describe, expect, test } from 'bun:test'
import * as Either from 'effect/Either'
import * as Effect from 'effect/Effect'

import {
  admitExactJobTerms,
  agreeExactJobTerms,
  createInMemoryAgreementStore,
  encodeExactJobTerms,
  type ExactJobTerms,
  ServiceId,
  TermsSignature,
  type TermsFailure,
  type TermsSignatureVerifier,
  TokenContract,
  type SignedTerms,
} from '../../economy/exact-job-terms.ts'
import {
  AtomicAmount,
  EvidenceHash,
  JobId,
  NetworkId,
  ParticipantId,
  WalletDestination,
} from '../../economy/job-lifecycle.ts'

const hash = (character: string) => EvidenceHash(character.repeat(64))

const terms = (overrides: Partial<ExactJobTerms> = {}): ExactJobTerms => ({
  acceptanceContractHash: hash('a'),
  artifactContractHash: hash('b'),
  asset: 'USDt',
  bidExpiry: 200,
  buyer: ParticipantId('buyer-1'),
  buyerWallet: WalletDestination('buyer-wallet'),
  decimals: 6,
  destination: WalletDestination('provider-wallet'),
  executionDeadline: 400,
  jobId: JobId('job-1'),
  maximumNativeFee: AtomicAmount(25n),
  network: NetworkId('ethereum-sepolia'),
  price: AtomicAmount(1_500_000n),
  provider: ParticipantId('provider-1'),
  serviceId: ServiceId('deterministic-coding-v1'),
  taskInputHash: hash('c'),
  tokenContract: TokenContract('usdt-contract'),
  ...overrides,
})

const checksum = (bytes: Uint8Array): number =>
  bytes.reduce((total, value) => (total + value) % 251, 0)

const signature = (bytes: Uint8Array, signer: string) =>
  TermsSignature(Uint8Array.of((checksum(bytes) + (signer === 'buyer-1' ? 1 : 2)) % 251))

const signed = async (input: ExactJobTerms): Promise<readonly [SignedTerms, SignedTerms]> => {
  const bytes = await Effect.runPromise(encodeExactJobTerms(input))
  return [
    { signer: ParticipantId('buyer-1'), signature: signature(bytes, 'buyer-1') },
    { signer: ParticipantId('provider-1'), signature: signature(bytes, 'provider-1') },
  ]
}

const verifier: TermsSignatureVerifier = {
  verify: ({ bytes, signer, signature: candidate }) =>
    candidate[0] === (checksum(bytes) + (signer === ParticipantId('buyer-1') ? 1 : 2)) % 251
      ? Effect.void
      : Effect.fail({
          _tag: 'signature-invalid',
          reason: 'signature does not belong to signed bytes',
        }),
}

const expectFailure = async <A>(
  effect: Effect.Effect<A, TermsFailure>,
  tag: TermsFailure['_tag'],
): Promise<void> => {
  const result = await Effect.runPromise(Effect.either(effect))
  expect(Either.isLeft(result)).toBe(true)
  if (Either.isLeft(result)) expect(result.left._tag).toBe(tag)
}

describe('exact job terms', () => {
  test('admits two signatures over one canonical exact payment and verifier contract', async () => {
    const agreed = terms()
    const agreement = await Effect.runPromise(
      agreeExactJobTerms(agreed, await signed(agreed), 100, verifier),
    )

    expect(agreement.termsHash).toHaveLength(64)
    expect(agreement.terms.price).toBe(AtomicAmount(1_500_000n))
  })

  test('admits one exact agreement idempotently and rejects another for the same job', async () => {
    const store = createInMemoryAgreementStore()
    const agreed = terms()
    const first = await Effect.runPromise(
      agreeExactJobTerms(agreed, await signed(agreed), 100, verifier),
    )
    const duplicate = await Effect.runPromise(admitExactJobTerms(first, store))

    expect(duplicate.outcome).toBe('accepted')
    expect((await Effect.runPromise(admitExactJobTerms(first, store))).outcome).toBe('duplicate')

    const conflictingTerms = terms({ price: AtomicAmount(1_500_001n) })
    const conflicting = await Effect.runPromise(
      agreeExactJobTerms(conflictingTerms, await signed(conflictingTerms), 100, verifier),
    )
    await expectFailure(admitExactJobTerms(conflicting, store), 'agreement-conflict')
  })

  test('rejects invalid terms before interpreting their expiry', async () => {
    const invalid = terms({ bidExpiry: -1 })
    await expectFailure(
      agreeExactJobTerms(
        invalid,
        [
          { signer: ParticipantId('buyer-1'), signature: TermsSignature(Uint8Array.of(1)) },
          { signer: ParticipantId('provider-1'), signature: TermsSignature(Uint8Array.of(2)) },
        ],
        0,
        verifier,
      ),
      'invalid-terms',
    )
  })

  test('refuses missing, expired, or altered counterparty terms', async () => {
    const agreed = terms()
    const [buyerSignature] = await signed(agreed)
    await expectFailure(
      agreeExactJobTerms(agreed, [buyerSignature], 100, verifier),
      'counterparty-signature-missing',
    )
    await expectFailure(
      agreeExactJobTerms(agreed, await signed(agreed), 201, verifier),
      'terms-expired',
    )
    await expectFailure(
      agreeExactJobTerms(
        terms({ destination: WalletDestination('attacker-wallet') }),
        await signed(agreed),
        100,
        verifier,
      ),
      'signature-invalid',
    )
  })
})

import { describe, expect, test } from 'bun:test'

import { generateKeyPairSync, sign } from 'node:crypto'

import * as Either from 'effect/Either'
import * as Effect from 'effect/Effect'

import {
  bindAgreementWitnessToVerification,
  decodeSignedAgreementWitness,
  deriveAgreementTermsHash,
  encodeAgreementWitnessAttestation,
  type AgreementWitnessInput,
} from '../../cli/agreement-witness.ts'

const hash = (character: string): string => character.repeat(64)

const baseWitness = (): Omit<AgreementWitnessInput, 'operatorSignature'> => ({
  buyerSignature: 'AQI=',
  operatorKeyId: 'buyer-local-ed25519-v1',
  providerSignature: 'AwQ=',
  schemaVersion: 1,
  terms: {
    acceptanceContractHash: hash('a'),
    artifactContractHash: hash('b'),
    asset: 'USDt',
    bidExpiry: 200,
    buyer: 'buyer-1',
    buyerWallet: '0xbuyer',
    decimals: 6,
    destination: '0xprovider',
    executionDeadline: 400,
    jobId: 'normalize-market-handle-v1',
    maximumNativeFee: '25000',
    network: 'ethereum-sepolia',
    price: '1500000',
    provider: 'provider-1',
    serviceId: 'deterministic-coding-v1',
    taskInputHash: hash('c'),
    tokenContract: 'usdt-contract',
  },
  termsHash: hash('d'),
  workspace: '.tmp/agentopoly-runs/reliable',
})

const signedWitness = (): Readonly<{
  readonly publicKey: string
  readonly witness: AgreementWitnessInput
}> => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const base = baseWitness()
  const unsigned = {
    ...base,
    termsHash: Effect.runSync(deriveAgreementTermsHash(base.terms)),
  }
  const bytes = Effect.runSync(encodeAgreementWitnessAttestation(unsigned))
  return {
    publicKey: publicKey.export({ format: 'pem', type: 'spki' }),
    witness: {
      ...unsigned,
      operatorSignature: sign(null, bytes, privateKey).toString('base64'),
    },
  }
}

const expectFailure = async <A>(
  effect: Effect.Effect<A, { readonly _tag: string }>,
  tag: string,
): Promise<void> => {
  const result = await Effect.runPromise(Effect.either(effect))
  expect(Either.isLeft(result)).toBe(true)
  if (Either.isLeft(result)) expect(result.left._tag).toBe(tag)
}

describe('durable signed agreement witness', () => {
  test('accepts a strict locally signed witness and binds its exact terms to verification', async () => {
    const { publicKey, witness } = signedWitness()
    const decoded = await Effect.runPromise(
      decodeSignedAgreementWitness(JSON.stringify(witness), {
        expectedWorkspace: witness.workspace,
        operatorPublicKey: publicKey,
      }),
    )

    expect(decoded.terms.jobId).toBe('normalize-market-handle-v1')
    expect(decoded.payment).toEqual({
      asset: 'USDt',
      atomicAmount: '1500000',
      destination: '0xprovider',
      maximumNativeFee: '25000',
      network: 'ethereum-sepolia',
      token: 'usdt',
    })
    const payment = await Effect.runPromise(
      bindAgreementWitnessToVerification(decoded, {
        artifactHash: hash('e'),
        passed: true,
        termsHash: decoded.termsHash,
        verificationHash: hash('f'),
      }),
    )
    expect(payment).toEqual(decoded.payment)
  })

  test('refuses malformed, altered, and replayed witnesses before policy evaluation', async () => {
    const { publicKey, witness } = signedWitness()
    await expectFailure(
      decodeSignedAgreementWitness(JSON.stringify({ ...witness, unexpected: true }), {
        expectedWorkspace: witness.workspace,
        operatorPublicKey: publicKey,
      }),
      'invalid-agreement-witness',
    )
    await expectFailure(
      decodeSignedAgreementWitness(JSON.stringify({ ...witness, workspace: 'other-workspace' }), {
        expectedWorkspace: witness.workspace,
        operatorPublicKey: publicKey,
      }),
      'agreement-witness-workspace-mismatch',
    )
    await expectFailure(
      decodeSignedAgreementWitness(
        JSON.stringify({ ...witness, terms: { ...witness.terms, price: '1500001' } }),
        { expectedWorkspace: witness.workspace, operatorPublicKey: publicKey },
      ),
      'agreement-witness-signature-invalid',
    )
  })

  test('refuses a verification with mismatched terms or a replayed failed decision', async () => {
    const { publicKey, witness } = signedWitness()
    const decoded = await Effect.runPromise(
      decodeSignedAgreementWitness(JSON.stringify(witness), {
        expectedWorkspace: witness.workspace,
        operatorPublicKey: publicKey,
      }),
    )

    await expectFailure(
      bindAgreementWitnessToVerification(decoded, {
        artifactHash: hash('e'),
        passed: true,
        termsHash: hash('0'),
        verificationHash: hash('f'),
      }),
      'agreement-witness-verification-mismatch',
    )
    await expectFailure(
      bindAgreementWitnessToVerification(decoded, {
        artifactHash: hash('e'),
        passed: false,
        termsHash: decoded.termsHash,
        verificationHash: hash('f'),
      }),
      'agreement-witness-verification-mismatch',
    )
  })
})

import * as Effect from 'effect/Effect'

import type { PaymentPolicy } from './payment-policy.ts'

export type FinalizePolicy = PaymentPolicy &
  Readonly<{
    readonly sourceAccountIndex: number
    readonly sourceAddress: string
    readonly sourceWallet: string
  }>

export type FinalizePolicyFailure = Readonly<{
  readonly _tag: 'invalid-finalize-policy'
  readonly reason: string
}>

const failure: FinalizePolicyFailure = {
  _tag: 'invalid-finalize-policy',
  reason: 'local WDK policy is absent or invalid',
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 256

const positiveAtomic = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && value.length <= 78

const nonnegativeAtomic = (value: unknown): value is string =>
  typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 78

const only = (value: Record<string, unknown>, fields: readonly string[]): boolean => {
  const allowed = new Set(fields)
  return Object.keys(value).every((key) => allowed.has(key))
}

export const decodeFinalizePolicy = (
  input: string | undefined,
): Effect.Effect<FinalizePolicy, FinalizePolicyFailure> =>
  Effect.gen(function* () {
    const decoded = yield* Effect.try({
      try: (): unknown => (input === undefined ? undefined : JSON.parse(input)),
      catch: () => failure,
    })
    if (
      !isRecord(decoded) ||
      !only(decoded, [
        'maximumAtomicAmount',
        'maximumNativeFee',
        'observedSourceAddress',
        'remainingAtomicAmount',
        'sourceAccountIndex',
        'sourceAddress',
        'sourceWallet',
      ]) ||
      !positiveAtomic(decoded['maximumAtomicAmount']) ||
      !nonnegativeAtomic(decoded['maximumNativeFee']) ||
      !identifier(decoded['observedSourceAddress']) ||
      !positiveAtomic(decoded['remainingAtomicAmount']) ||
      typeof decoded['sourceAccountIndex'] !== 'number' ||
      !Number.isSafeInteger(decoded['sourceAccountIndex']) ||
      decoded['sourceAccountIndex'] < 0 ||
      !identifier(decoded['sourceAddress']) ||
      !identifier(decoded['sourceWallet'])
    ) {
      return yield* Effect.fail(failure)
    }
    return {
      maximumAtomicAmount: decoded['maximumAtomicAmount'],
      maximumNativeFee: decoded['maximumNativeFee'],
      observedSourceAddress: decoded['observedSourceAddress'],
      remainingAtomicAmount: decoded['remainingAtomicAmount'],
      sourceAccountIndex: decoded['sourceAccountIndex'],
      sourceAddress: decoded['sourceAddress'],
      sourceWallet: decoded['sourceWallet'],
    }
  })

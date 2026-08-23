export type PaymentTuple = Readonly<{
  readonly asset: 'USDt'
  readonly atomicAmount: string
  readonly destination: string
  readonly maximumNativeFee: string
  readonly network: string
  readonly sourceAccountIndex: number
  readonly sourceAddress: string
  readonly sourceWallet: string
  readonly token: 'usdt'
}>

export type PaymentWitness = Readonly<{
  readonly artifactHash: string
  readonly termsHash: string
  readonly verificationHash: string
}>

export type PaymentPolicy = Readonly<{
  readonly maximumAtomicAmount: string
  readonly maximumNativeFee: string
  readonly observedSourceAddress: string
  readonly remainingAtomicAmount: string
}>

export type PaymentAuthorization = PaymentTuple & PaymentWitness
export type PaymentDecision =
  | Readonly<{ readonly ok: true; readonly value: PaymentAuthorization }>
  | Readonly<{
      readonly ok: false
      readonly reason: 'amount-limit' | 'fee-limit' | 'invalid-amount' | 'verification-mismatch'
    }>

const atomic = (value: string): bigint | undefined =>
  /^[1-9][0-9]*$/.test(value) ? BigInt(value) : undefined

export const authorizePayment = (
  input: Readonly<{
    readonly agreement: PaymentTuple
    readonly artifactHash: string
    readonly policy: PaymentPolicy
    readonly termsHash: string
    readonly verification: PaymentWitness & Readonly<{ readonly passed: boolean }>
    readonly verificationHash: string
  }>,
): PaymentDecision => {
  const amount = atomic(input.agreement.atomicAmount)
  const amountLimit = atomic(input.policy.maximumAtomicAmount)
  const remaining = atomic(input.policy.remainingAtomicAmount)
  const fee = atomic(input.agreement.maximumNativeFee)
  const feeLimit = atomic(input.policy.maximumNativeFee)
  if (
    amount === undefined ||
    amountLimit === undefined ||
    remaining === undefined ||
    fee === undefined ||
    feeLimit === undefined
  ) {
    return { ok: false, reason: 'invalid-amount' }
  }
  if (amount > amountLimit || amount > remaining) return { ok: false, reason: 'amount-limit' }
  if (fee > feeLimit) return { ok: false, reason: 'fee-limit' }
  if (
    !input.verification.passed ||
    input.policy.observedSourceAddress !== input.agreement.sourceAddress ||
    input.verification.termsHash !== input.termsHash ||
    input.verification.artifactHash !== input.artifactHash ||
    input.verification.verificationHash !== input.verificationHash
  ) {
    return { ok: false, reason: 'verification-mismatch' }
  }
  return {
    ok: true,
    value: {
      ...input.agreement,
      artifactHash: input.artifactHash,
      termsHash: input.termsHash,
      verificationHash: input.verificationHash,
    },
  }
}

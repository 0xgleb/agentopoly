export type PaymentReceipt = Readonly<{
  readonly artifactHash: string
  readonly atomicAmount: string
  readonly attemptId: string
  readonly authorizationKey: string
  readonly destination: string
  readonly network: string
  readonly termsHash: string
  readonly transactionHash: string
  readonly verificationHash: string
}>

export type ReceiptResult =
  | Readonly<{ readonly ok: true; readonly value: PaymentReceipt }>
  | Readonly<{ readonly ok: false; readonly reason: 'invalid-receipt' }>

const hash = (value: string): boolean => /^[a-f0-9]{64}$/.test(value)
const identifier = (value: string): boolean => value.trim().length > 0 && value.length <= 256

export const createPaymentReceipt = (input: PaymentReceipt): ReceiptResult =>
  hash(input.artifactHash) &&
  hash(input.termsHash) &&
  hash(input.transactionHash) &&
  hash(input.verificationHash) &&
  /^[1-9][0-9]*$/.test(input.atomicAmount) &&
  identifier(input.attemptId) &&
  identifier(input.authorizationKey) &&
  identifier(input.destination) &&
  identifier(input.network)
    ? { ok: true, value: input }
    : { ok: false, reason: 'invalid-receipt' }

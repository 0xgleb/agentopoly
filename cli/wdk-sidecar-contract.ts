import * as Effect from 'effect/Effect'

export type PaymentPreviewRequest = Readonly<{
  readonly artifactHash: string
  readonly asset: 'USDt'
  readonly atomicAmount: string
  readonly destination: string
  readonly maximumNativeFee: string
  readonly network: string
  readonly sourceAccountIndex: number
  readonly sourceWallet: string
  readonly termsHash: string
  readonly token: 'usdt'
  readonly type: 'preview-payment'
  readonly verificationHash: string
}>

export type ReservedPaymentAttempt = Readonly<{
  readonly artifactHash: string
  readonly asset: 'USDt'
  readonly atomicAmount: string
  readonly authorizationKey: string
  readonly destination: string
  readonly maximumNativeFee: string
  readonly network: string
  readonly previewExpiresAt: number
  readonly previewHash: string
  readonly sourceAccountIndex: number
  readonly sourceWallet: string
  readonly termsHash: string
  readonly token: 'usdt'
  readonly type: 'broadcast-reserved-payment'
  readonly verificationHash: string
}>

export type SidecarCommand = PaymentPreviewRequest | ReservedPaymentAttempt

export type SidecarFailure = Readonly<{
  readonly _tag: 'invalid-command' | 'unknown-command'
  readonly reason: string
}>

const hash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 256

const atomicAmount = (value: unknown): value is string =>
  typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && value.length <= 78

const nonnegativeSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const only = (value: Record<string, unknown>, fields: readonly string[]): boolean => {
  const allowed = new Set(fields)
  return Object.keys(value).every((key) => allowed.has(key))
}

const failure = (tag: SidecarFailure['_tag'], reason: string): SidecarFailure => ({
  _tag: tag,
  reason,
})

const common = (
  value: Record<string, unknown>,
): Omit<PaymentPreviewRequest, 'type'> | undefined => {
  const sourceAccountIndex = value['sourceAccountIndex']
  if (
    value['asset'] !== 'USDt' ||
    !atomicAmount(value['atomicAmount']) ||
    !identifier(value['destination']) ||
    !atomicAmount(value['maximumNativeFee']) ||
    !identifier(value['network']) ||
    !nonnegativeSafeInteger(sourceAccountIndex) ||
    !identifier(value['sourceWallet']) ||
    !hash(value['termsHash']) ||
    value['token'] !== 'usdt' ||
    !hash(value['artifactHash']) ||
    !hash(value['verificationHash'])
  ) {
    return undefined
  }
  return {
    artifactHash: value['artifactHash'],
    asset: 'USDt',
    atomicAmount: value['atomicAmount'],
    destination: value['destination'],
    maximumNativeFee: value['maximumNativeFee'],
    network: value['network'],
    sourceAccountIndex,
    sourceWallet: value['sourceWallet'],
    termsHash: value['termsHash'],
    token: 'usdt',
    verificationHash: value['verificationHash'],
  }
}

export const decodeSidecarCommand = (
  input: unknown,
): Effect.Effect<SidecarCommand, SidecarFailure> => {
  if (!isRecord(input)) return Effect.fail(failure('invalid-command', 'command must be an object'))
  if (input['type'] !== 'preview-payment' && input['type'] !== 'broadcast-reserved-payment') {
    return Effect.fail(failure('unknown-command', 'sidecar command type is not allowed'))
  }
  const fields =
    input['type'] === 'preview-payment'
      ? [
          'artifactHash',
          'asset',
          'atomicAmount',
          'destination',
          'maximumNativeFee',
          'network',
          'sourceAccountIndex',
          'sourceWallet',
          'termsHash',
          'token',
          'type',
          'verificationHash',
        ]
      : [
          'artifactHash',
          'asset',
          'atomicAmount',
          'authorizationKey',
          'destination',
          'maximumNativeFee',
          'network',
          'previewExpiresAt',
          'previewHash',
          'sourceAccountIndex',
          'sourceWallet',
          'termsHash',
          'token',
          'type',
          'verificationHash',
        ]
  if (!only(input, fields))
    return Effect.fail(failure('invalid-command', 'command has unknown fields'))

  const parsed = common(input)
  if (parsed === undefined)
    return Effect.fail(failure('invalid-command', 'payment tuple is invalid'))
  if (input['type'] === 'preview-payment')
    return Effect.succeed({ ...parsed, type: 'preview-payment' })
  const previewExpiresAt = input['previewExpiresAt']
  if (
    !identifier(input['authorizationKey']) ||
    !hash(input['previewHash']) ||
    !nonnegativeSafeInteger(previewExpiresAt)
  ) {
    return Effect.fail(failure('invalid-command', 'reserved payment attempt is invalid'))
  }
  return Effect.succeed({
    ...parsed,
    authorizationKey: input['authorizationKey'],
    previewExpiresAt,
    previewHash: input['previewHash'],
    type: 'broadcast-reserved-payment',
  })
}

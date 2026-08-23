import * as Effect from 'effect/Effect'

export type ReservedPaymentAttempt = Readonly<{
  readonly attemptId: string
  readonly authorizationKey: string
}>

export type PaymentReservationFailure = Readonly<{
  readonly _tag: 'already-reserved' | 'invalid-reservation'
  readonly reason: string
}>

export type PaymentReservations = Readonly<{
  readonly find: (authorizationKey: string) => ReservedPaymentAttempt | undefined
  readonly reserve: (attempt: ReservedPaymentAttempt) => boolean
}>

const identifier = (value: string): boolean => value.trim().length > 0 && value.length <= 256

const failure = (
  tag: PaymentReservationFailure['_tag'],
  reason: string,
): PaymentReservationFailure => ({ _tag: tag, reason })

export const createPaymentReservations = (): PaymentReservations => {
  const attempts = new Map<string, ReservedPaymentAttempt>()
  return {
    find: (authorizationKey) => attempts.get(authorizationKey),
    reserve: (attempt) => {
      if (attempts.has(attempt.authorizationKey)) return false
      attempts.set(attempt.authorizationKey, attempt)
      return true
    },
  }
}

export const reservePayment = (
  reservations: PaymentReservations,
  authorizationKey: string,
  attemptId: string,
): Effect.Effect<ReservedPaymentAttempt, PaymentReservationFailure> => {
  if (!identifier(authorizationKey) || !identifier(attemptId)) {
    return Effect.fail(
      failure('invalid-reservation', 'authorization key and attempt ID are required'),
    )
  }
  const attempt = { attemptId, authorizationKey }
  return reservations.reserve(attempt)
    ? Effect.succeed(attempt)
    : Effect.fail(failure('already-reserved', 'authorization key already has a payment attempt'))
}

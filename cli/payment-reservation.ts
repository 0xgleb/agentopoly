import * as Effect from 'effect/Effect'

export type ReservedPaymentAttempt = Readonly<{
  readonly attemptId: string
  readonly authorizationKey: string
  readonly status: 'broadcasting' | 'reserved'
}>

export type PaymentReservationFailure = Readonly<{
  readonly _tag: 'already-reserved' | 'attempt-mismatch' | 'invalid-reservation'
  readonly reason: string
}>

export type PaymentReservations = Readonly<{
  readonly all: () => readonly ReservedPaymentAttempt[]
  readonly find: (authorizationKey: string) => ReservedPaymentAttempt | undefined
  readonly replace: (attempt: ReservedPaymentAttempt) => boolean
  readonly reserve: (attempt: ReservedPaymentAttempt) => boolean
}>

export type PaymentReservationSnapshot = Readonly<{
  readonly attempts: readonly ReservedPaymentAttempt[]
  readonly schemaVersion: 1
}>

const identifier = (value: string): boolean => value.trim().length > 0 && value.length <= 256

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const failure = (
  tag: PaymentReservationFailure['_tag'],
  reason: string,
): PaymentReservationFailure => ({ _tag: tag, reason })

export const createPaymentReservations = (): PaymentReservations => {
  const attempts = new Map<string, ReservedPaymentAttempt>()
  return {
    all: () => [...attempts.values()],
    find: (authorizationKey) => attempts.get(authorizationKey),
    replace: (attempt) => {
      if (!attempts.has(attempt.authorizationKey)) return false
      attempts.set(attempt.authorizationKey, attempt)
      return true
    },
    reserve: (attempt) => {
      if (attempts.has(attempt.authorizationKey)) return false
      attempts.set(attempt.authorizationKey, attempt)
      return true
    },
  }
}

export const snapshotPaymentReservations = (
  reservations: PaymentReservations,
): PaymentReservationSnapshot => ({ attempts: reservations.all(), schemaVersion: 1 })

export const decodePaymentReservations = (
  snapshot: unknown,
): Effect.Effect<PaymentReservations, PaymentReservationFailure> => {
  if (
    typeof snapshot !== 'object' ||
    snapshot === null ||
    !('schemaVersion' in snapshot) ||
    snapshot.schemaVersion !== 1 ||
    !('attempts' in snapshot) ||
    !Array.isArray(snapshot.attempts)
  ) {
    return Effect.fail(failure('invalid-reservation', 'reservation snapshot has an invalid shape'))
  }
  const reservations = createPaymentReservations()
  for (const attempt of snapshot.attempts) {
    if (
      !isRecord(attempt) ||
      typeof attempt['authorizationKey'] !== 'string' ||
      typeof attempt['attemptId'] !== 'string' ||
      (attempt['status'] !== 'reserved' && attempt['status'] !== 'broadcasting') ||
      !identifier(attempt['authorizationKey']) ||
      !identifier(attempt['attemptId']) ||
      !reservations.reserve({
        authorizationKey: attempt['authorizationKey'],
        attemptId: attempt['attemptId'],
        status: attempt['status'],
      })
    ) {
      return Effect.fail(failure('invalid-reservation', 'reservation snapshot violates invariants'))
    }
  }
  return Effect.succeed(reservations)
}

export const markPaymentBroadcasting = (
  reservations: PaymentReservations,
  authorizationKey: string,
  attemptId: string,
): Effect.Effect<ReservedPaymentAttempt, PaymentReservationFailure> => {
  const previous = reservations.find(authorizationKey)
  if (previous === undefined || previous.attemptId !== attemptId) {
    return Effect.fail(failure('attempt-mismatch', 'attempt does not own this authorization key'))
  }
  if (previous.status === 'broadcasting') return Effect.succeed(previous)
  const broadcasting = { ...previous, status: 'broadcasting' as const }
  return reservations.replace(broadcasting)
    ? Effect.succeed(broadcasting)
    : Effect.fail(failure('attempt-mismatch', 'reservation disappeared before broadcasting'))
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
  const attempt = { attemptId, authorizationKey, status: 'reserved' as const }
  return reservations.reserve(attempt)
    ? Effect.succeed(attempt)
    : Effect.fail(failure('already-reserved', 'authorization key already has a payment attempt'))
}

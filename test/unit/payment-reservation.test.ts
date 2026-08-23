import { describe, expect, test } from 'bun:test'
import * as Either from 'effect/Either'
import * as Effect from 'effect/Effect'

import { createPaymentReservations, reservePayment } from '../../cli/payment-reservation.ts'

describe('payment reservation', () => {
  test('reserves one authorization key exactly once', async () => {
    const reservations = createPaymentReservations()
    const first = await Effect.runPromise(
      reservePayment(reservations, 'authorization-1', 'attempt-1'),
    )
    const duplicate = await Effect.runPromise(
      Effect.either(reservePayment(reservations, 'authorization-1', 'attempt-2')),
    )

    expect(first).toEqual({ attemptId: 'attempt-1', authorizationKey: 'authorization-1' })
    expect(Either.isLeft(duplicate)).toBe(true)
  })
})

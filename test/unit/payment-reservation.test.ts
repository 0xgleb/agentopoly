import { describe, expect, test } from 'bun:test'
import * as Either from 'effect/Either'
import * as Effect from 'effect/Effect'

import {
  createPaymentReservations,
  decodePaymentReservations,
  reservePayment,
  snapshotPaymentReservations,
} from '../../cli/payment-reservation.ts'

describe('payment reservation', () => {
  test('preserves reservations through a validated snapshot', async () => {
    const reservations = createPaymentReservations()
    await Effect.runPromise(reservePayment(reservations, 'authorization-1', 'attempt-1'))
    const restored = await Effect.runPromise(
      decodePaymentReservations(snapshotPaymentReservations(reservations)),
    )

    expect(restored.find('authorization-1')).toEqual({
      attemptId: 'attempt-1',
      authorizationKey: 'authorization-1',
    })
  })

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

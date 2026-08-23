import { describe, expect, test } from 'bun:test'
import * as Either from 'effect/Either'
import * as Effect from 'effect/Effect'

import {
  createPaymentReservations,
  decodePaymentReservations,
  markPaymentBroadcasting,
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
      status: 'reserved',
    })
  })

  test('records a broadcasting marker only for the reserved attempt', async () => {
    const reservations = createPaymentReservations()
    await Effect.runPromise(reservePayment(reservations, 'authorization-1', 'attempt-1'))

    expect(
      await Effect.runPromise(
        markPaymentBroadcasting(reservations, 'authorization-1', 'attempt-1'),
      ),
    ).toEqual({
      attemptId: 'attempt-1',
      authorizationKey: 'authorization-1',
      status: 'broadcasting',
    })
    expect(
      Either.isLeft(
        await Effect.runPromise(
          Effect.either(markPaymentBroadcasting(reservations, 'authorization-1', 'attempt-2')),
        ),
      ),
    ).toBe(true)
  })

  test('reserves one authorization key exactly once', async () => {
    const reservations = createPaymentReservations()
    const first = await Effect.runPromise(
      reservePayment(reservations, 'authorization-1', 'attempt-1'),
    )
    const duplicate = await Effect.runPromise(
      Effect.either(reservePayment(reservations, 'authorization-1', 'attempt-2')),
    )

    expect(first).toEqual({
      attemptId: 'attempt-1',
      authorizationKey: 'authorization-1',
      status: 'reserved',
    })
    expect(Either.isLeft(duplicate)).toBe(true)
  })
})

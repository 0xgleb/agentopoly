import { createHash } from 'node:crypto'

import * as Effect from 'effect/Effect'

import {
  markPaymentBroadcasting,
  markPaymentReconciliationPending,
  recordPaymentBroadcast,
  reservePayment,
  snapshotPaymentReservations,
  type PaymentReservations,
  type PaymentReservationSnapshot,
} from './payment-reservation.ts'
import { createPaymentReceipt, type PaymentReceipt } from './payment-receipt.ts'
import { authorizePreviewedPayment, type PaymentAuthorization } from './payment-policy.ts'
import type { IssuedPreview, PreviewRegistry } from './wdk-preview-registry.ts'
import { decodeSidecarCommand, type ReservedPaymentAttempt } from './wdk-sidecar-contract.ts'
import { enforcesWdkSourceConfig, type WdkSourceConfig } from './wdk-source-config.ts'
import { invokeWdkBroadcast } from './wdk-broadcast.ts'
import type { WdkGateway } from './wdk-gateway.ts'

export type ReservationPersistenceFailure = Readonly<{
  readonly _tag: 'reservation-persistence-failed'
  readonly reason: string
}>

export type ReservationPersistence = Readonly<{
  readonly save: (
    snapshot: PaymentReservationSnapshot,
  ) => Effect.Effect<void, ReservationPersistenceFailure>
}>

export type FinalizeBroadcastFailure = Readonly<{
  readonly _tag:
    | 'gateway-unavailable'
    | 'invalid-broadcast-witness'
    | 'reconciliation-pending'
    | 'reservation-conflict'
    | 'reservation-persistence-failed'
  readonly reason: string
}>

export type FinalizeBroadcastInput = Readonly<{
  readonly attemptId: string
  readonly authorization: PaymentAuthorization
  readonly gateway: WdkGateway
  readonly now: number
  readonly persistence: ReservationPersistence
  readonly preview: IssuedPreview
  readonly previews: PreviewRegistry
  readonly reservations: PaymentReservations
  readonly sourceConfig: WdkSourceConfig
}>

const failure = (
  tag: FinalizeBroadcastFailure['_tag'],
  reason: string,
): FinalizeBroadcastFailure => ({ _tag: tag, reason })

export const derivePaymentAuthorizationKey = (authorization: PaymentAuthorization): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        artifactHash: authorization.artifactHash,
        asset: authorization.asset,
        atomicAmount: authorization.atomicAmount,
        destination: authorization.destination,
        maximumNativeFee: authorization.maximumNativeFee,
        network: authorization.network,
        sourceAccountIndex: authorization.sourceAccountIndex,
        sourceAddress: authorization.sourceAddress,
        sourceWallet: authorization.sourceWallet,
        termsHash: authorization.termsHash,
        token: authorization.token,
        verificationHash: authorization.verificationHash,
      }),
      'utf8',
    )
    .digest('hex')

const receiptFor = (
  input: FinalizeBroadcastInput,
  authorizationKey: string,
  transactionHash: string,
): Effect.Effect<PaymentReceipt, FinalizeBroadcastFailure> => {
  const receipt = createPaymentReceipt({
    artifactHash: input.authorization.artifactHash,
    atomicAmount: input.authorization.atomicAmount,
    attemptId: input.attemptId,
    authorizationKey,
    destination: input.authorization.destination,
    network: input.authorization.network,
    termsHash: input.authorization.termsHash,
    transactionHash,
    verificationHash: input.authorization.verificationHash,
  })
  return receipt.ok
    ? Effect.succeed(receipt.value)
    : Effect.fail(failure('invalid-broadcast-witness', 'payment receipt violates its contract'))
}

const persist = (input: FinalizeBroadcastInput): Effect.Effect<void, FinalizeBroadcastFailure> =>
  input.persistence
    .save(snapshotPaymentReservations(input.reservations))
    .pipe(Effect.mapError((cause) => failure('reservation-persistence-failed', cause.reason)))

const commandFor = (
  input: FinalizeBroadcastInput,
  authorizationKey: string,
): ReservedPaymentAttempt => ({
  artifactHash: input.authorization.artifactHash,
  asset: input.authorization.asset,
  atomicAmount: input.authorization.atomicAmount,
  authorizationKey,
  destination: input.authorization.destination,
  maximumNativeFee: input.authorization.maximumNativeFee,
  network: input.authorization.network,
  previewExpiresAt: input.preview.previewExpiresAt,
  previewHash: input.preview.previewHash,
  sourceAccountIndex: input.authorization.sourceAccountIndex,
  sourceWallet: input.authorization.sourceWallet,
  termsHash: input.authorization.termsHash,
  token: input.authorization.token,
  type: 'broadcast-reserved-payment',
  verificationHash: input.authorization.verificationHash,
})

export const finalizeAuthorizedBroadcast = (
  input: FinalizeBroadcastInput,
): Effect.Effect<PaymentReceipt, FinalizeBroadcastFailure> =>
  Effect.gen(function* () {
    if (!input.gateway.available) {
      return yield* Effect.fail(
        failure('gateway-unavailable', 'local WDK gateway is not configured'),
      )
    }
    if (!Number.isSafeInteger(input.now) || input.now < 0) {
      return yield* Effect.fail(failure('invalid-broadcast-witness', 'broadcast time is invalid'))
    }

    const authorizationKey = derivePaymentAuthorizationKey(input.authorization)
    const existing = input.reservations.find(authorizationKey)
    if (existing !== undefined) {
      if (existing.attemptId === input.attemptId && existing.status === 'broadcasted') {
        return yield* receiptFor(input, authorizationKey, existing.transactionHash)
      }
      if (
        existing.attemptId === input.attemptId &&
        (existing.status === 'broadcasting' || existing.status === 'reconciliation-pending')
      ) {
        return yield* Effect.fail(
          failure(
            'reconciliation-pending',
            'payment attempt is pending reconciliation and cannot be retried',
          ),
        )
      }
      return yield* Effect.fail(
        failure('reservation-conflict', 'authorization key is already reserved'),
      )
    }

    if (!enforcesWdkSourceConfig(input.sourceConfig, input.authorization)) {
      return yield* Effect.fail(
        failure('invalid-broadcast-witness', 'source wallet configuration does not match'),
      )
    }
    const feeDecision = authorizePreviewedPayment({
      authorization: input.authorization,
      estimatedNativeFee: input.preview.estimatedNativeFee,
      maximumNativeFee: input.authorization.maximumNativeFee,
    })
    if (!feeDecision.ok) {
      return yield* Effect.fail(
        failure('invalid-broadcast-witness', `preview fee was refused: ${feeDecision.reason}`),
      )
    }
    const decoded = yield* decodeSidecarCommand(commandFor(input, authorizationKey)).pipe(
      Effect.mapError((cause) => failure('invalid-broadcast-witness', cause.reason)),
    )
    if (decoded.type !== 'broadcast-reserved-payment') {
      return yield* Effect.fail(
        failure('invalid-broadcast-witness', 'broadcast command has the wrong type'),
      )
    }

    const previewMatches = input.previews.consume(
      {
        atomicAmount: input.authorization.atomicAmount,
        destination: input.authorization.destination,
        network: input.authorization.network,
        previewExpiresAt: input.preview.previewExpiresAt,
        previewHash: input.preview.previewHash,
        termsHash: input.authorization.termsHash,
        verificationHash: input.authorization.verificationHash,
      },
      input.now,
    )
    if (!previewMatches) {
      return yield* Effect.fail(
        failure('invalid-broadcast-witness', 'preview is stale, replayed, or mismatched'),
      )
    }

    yield* reservePayment(input.reservations, authorizationKey, input.attemptId).pipe(
      Effect.mapError((cause) => failure('reservation-conflict', cause.reason)),
    )
    yield* persist(input)
    yield* markPaymentBroadcasting(input.reservations, authorizationKey, input.attemptId).pipe(
      Effect.mapError((cause) => failure('reservation-conflict', cause.reason)),
    )
    yield* persist(input)

    const broadcast = yield* Effect.either(invokeWdkBroadcast(input.gateway, decoded))
    if (broadcast._tag === 'Left') {
      yield* markPaymentReconciliationPending(
        input.reservations,
        authorizationKey,
        input.attemptId,
      ).pipe(Effect.mapError((cause) => failure('reservation-conflict', cause.reason)))
      yield* persist(input)
      return yield* Effect.fail(
        failure('reconciliation-pending', `WDK result is indeterminate: ${broadcast.left.reason}`),
      )
    }

    yield* recordPaymentBroadcast(
      input.reservations,
      authorizationKey,
      input.attemptId,
      broadcast.right.transactionHash,
    ).pipe(Effect.mapError((cause) => failure('reservation-conflict', cause.reason)))
    yield* persist(input)
    return yield* receiptFor(input, authorizationKey, broadcast.right.transactionHash)
  })

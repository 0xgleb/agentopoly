import * as Effect from 'effect/Effect'

import { createPaymentReceipt, type PaymentReceipt } from './payment-receipt.ts'
import type { PaymentAuthorization } from './payment-policy.ts'
import {
  derivePaymentAuthorizationKey,
  finalizeAuthorizedBroadcast,
  type FinalizeBroadcastFailure,
  type FinalizeBroadcastInput,
} from './finalize-broadcast.ts'

export type FinalizeGateway = Readonly<{
  readonly settle: (
    authorization: PaymentAuthorization,
  ) => Effect.Effect<PaymentReceipt, FinalizeBroadcastFailure>
}>

export type PaymentReceiptEvent = PaymentReceipt &
  Readonly<{
    readonly evidenceSource: 'live-agent-run'
    readonly jobId: string
    readonly type: 'receipt.recorded'
    readonly workspace: string
  }>

const unavailable: FinalizeBroadcastFailure = {
  _tag: 'gateway-unavailable',
  reason: 'local WDK gateway is not configured',
}

export const unavailableFinalizeGateway: FinalizeGateway = {
  settle: () => Effect.fail(unavailable),
}

export const createFinalizeGateway = (
  input: Omit<FinalizeBroadcastInput, 'authorization'>,
): FinalizeGateway => ({
  settle: (authorization) => finalizeAuthorizedBroadcast({ ...input, authorization }),
})

export const validatePaymentReceiptForAuthorization = (
  receipt: PaymentReceipt,
  authorization: PaymentAuthorization,
): Effect.Effect<PaymentReceipt, FinalizeBroadcastFailure> => {
  const decoded = createPaymentReceipt(receipt)
  if (
    !decoded.ok ||
    decoded.value.artifactHash !== authorization.artifactHash ||
    decoded.value.atomicAmount !== authorization.atomicAmount ||
    decoded.value.authorizationKey !== derivePaymentAuthorizationKey(authorization) ||
    decoded.value.destination !== authorization.destination ||
    decoded.value.network !== authorization.network ||
    decoded.value.termsHash !== authorization.termsHash ||
    decoded.value.verificationHash !== authorization.verificationHash
  ) {
    return Effect.fail({
      _tag: 'invalid-broadcast-witness',
      reason: 'injected payment receipt does not match the exact authorization',
    })
  }
  return Effect.succeed(decoded.value)
}

export const derivePaymentReceiptEvent = (
  receipt: PaymentReceipt,
  jobId: string,
  workspace: string,
): PaymentReceiptEvent => ({
  ...receipt,
  evidenceSource: 'live-agent-run',
  jobId,
  type: 'receipt.recorded',
  workspace,
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const recordedReceiptFields = new Set([
  'artifactHash',
  'atomicAmount',
  'attemptId',
  'authorizationKey',
  'destination',
  'evidenceSource',
  'jobId',
  'network',
  'recordedAt',
  'schemaVersion',
  'termsHash',
  'transactionHash',
  'type',
  'verificationHash',
  'workspace',
])

const receiptEquals = (value: Record<string, unknown>, event: PaymentReceiptEvent): boolean =>
  Object.keys(value).every((key) => recordedReceiptFields.has(key)) &&
  value['schemaVersion'] === 2 &&
  typeof value['recordedAt'] === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value['recordedAt']) &&
  value['evidenceSource'] === event.evidenceSource &&
  value['artifactHash'] === event.artifactHash &&
  value['atomicAmount'] === event.atomicAmount &&
  value['attemptId'] === event.attemptId &&
  value['authorizationKey'] === event.authorizationKey &&
  value['destination'] === event.destination &&
  value['jobId'] === event.jobId &&
  value['network'] === event.network &&
  value['termsHash'] === event.termsHash &&
  value['transactionHash'] === event.transactionHash &&
  value['type'] === event.type &&
  value['verificationHash'] === event.verificationHash &&
  value['workspace'] === event.workspace

export const selectPaymentReceiptToAppend = (
  eventLog: string,
  event: PaymentReceiptEvent,
): Effect.Effect<readonly PaymentReceiptEvent[], FinalizeBroadcastFailure> =>
  Effect.gen(function* () {
    const lines = eventLog
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    const decoded = yield* Effect.forEach(lines, (line) =>
      Effect.option(
        Effect.try({
          try: (): unknown => JSON.parse(line),
          catch: (): FinalizeBroadcastFailure => ({
            _tag: 'invalid-broadcast-witness',
            reason: 'event log contains malformed JSON',
          }),
        }),
      ),
    )
    const records = decoded.flatMap((candidate) =>
      candidate._tag === 'Some' ? [candidate.value] : [],
    )
    const matching = records.filter(
      (value): value is Record<string, unknown> =>
        isRecord(value) &&
        value['type'] === event.type &&
        value['schemaVersion'] === 2 &&
        value['workspace'] === event.workspace &&
        value['jobId'] === event.jobId,
    )
    if (matching.length === 0) return [event]
    if (!matching.every((value) => receiptEquals(value, event))) {
      return yield* Effect.fail<FinalizeBroadcastFailure>({
        _tag: 'invalid-broadcast-witness',
        reason: 'payment receipt conflicts with the authorized broadcast',
      })
    }
    return []
  })

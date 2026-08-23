import * as Effect from 'effect/Effect'

import { decodeBroadcastResult } from './wdk-response.ts'
import type { ReservedPaymentAttempt } from './wdk-sidecar-contract.ts'
import type { WdkGateway } from './wdk-gateway.ts'

export type WdkBroadcastFailure = Readonly<{
  readonly _tag: 'gateway-failed' | 'gateway-unavailable' | 'malformed-response'
  readonly reason: string
}>

const failure = (tag: WdkBroadcastFailure['_tag'], reason: string): WdkBroadcastFailure => ({
  _tag: tag,
  reason,
})

export const invokeWdkBroadcast = (
  gateway: WdkGateway,
  command: ReservedPaymentAttempt,
): Effect.Effect<Readonly<{ readonly transactionHash: string }>, WdkBroadcastFailure> => {
  if (!gateway.available) {
    return Effect.fail(failure('gateway-unavailable', 'local WDK gateway is not configured'))
  }
  return gateway.invoke(command).pipe(
    Effect.mapError((cause) => failure(cause._tag, cause.reason)),
    Effect.flatMap((response) =>
      decodeBroadcastResult(response, {
        atomicAmount: command.atomicAmount,
        destination: command.destination,
        network: command.network,
      }).pipe(
        Effect.mapError(() =>
          failure('malformed-response', 'WDK broadcast response is incomplete or mismatched'),
        ),
      ),
    ),
  )
}

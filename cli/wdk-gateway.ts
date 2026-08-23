import * as Effect from 'effect/Effect'

import type { ReservedPaymentAttempt } from './wdk-sidecar-contract.ts'

export type WdkGatewayFailure = Readonly<{
  readonly _tag: 'gateway-failed' | 'gateway-unavailable'
  readonly reason: string
}>

export type WdkGateway = Readonly<{
  readonly available: boolean
  readonly invoke: (command: ReservedPaymentAttempt) => Effect.Effect<unknown, WdkGatewayFailure>
}>

const unavailable: WdkGatewayFailure = {
  _tag: 'gateway-unavailable',
  reason: 'local WDK gateway is not configured',
}

export const unavailableWdkGateway: WdkGateway = {
  available: false,
  invoke: () => Effect.fail(unavailable),
}

import * as Brand from 'effect/Brand'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import PearRuntimeHost from 'pear-runtime'

import {
  FailureReason,
  type ParticipantWorker,
  type WorkerShutdownFailure,
  type WorkerStartFailure,
} from './participant.ts'
import type { ProtocolEnvelope, Result } from '../protocol/envelope-boundary.ts'

export type PearDataDirectory = string & Brand.Brand<'PearDataDirectory'>
export const PearDataDirectory = Brand.refined<PearDataDirectory>(
  (value) => value.trim().length > 0 && value.length <= 1024,
  () => Brand.error('Pear data directory must be non-empty'),
)

export type BareWorkerEntrypoint = string & Brand.Brand<'BareWorkerEntrypoint'>
export const BareWorkerEntrypoint = Brand.refined<BareWorkerEntrypoint>(
  (value) => value.trim().length > 0 && value.length <= 1024,
  () => Brand.error('Bare worker entrypoint must be non-empty'),
)

export type PeerFrameAdmission = (frame: Uint8Array) => Result<ProtocolEnvelope>

export type LocalDhtBootstrap = string & Brand.Brand<'LocalDhtBootstrap'>
export const LocalDhtBootstrap = Brand.refined<LocalDhtBootstrap>(
  (value) =>
    /^127\.0\.0\.1:(?:[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/.test(
      value,
    ),
  () => Brand.error('local DHT bootstrap must be a loopback IPv4 endpoint with a valid port'),
)

export type LocalDiscoveryRole = 'client' | 'server'

export type PearWorkerOptions = Readonly<{
  readonly dataDirectory: PearDataDirectory
  readonly localDhtBootstrap?: LocalDhtBootstrap
  readonly localDiscoveryRole?: LocalDiscoveryRole
  readonly onAcceptedPeerEnvelope?: (envelope: ProtocolEnvelope) => void
  readonly peerFrameAdmission?: PeerFrameAdmission
  readonly startupTimeout: Duration.Duration
  readonly workerEntrypoint: BareWorkerEntrypoint
}>

export type PearSidecar = Readonly<{
  readonly destroy: () => void
  readonly on: (event: 'data', listener: (data: Uint8Array) => void) => void
  readonly write?: (data: Uint8Array) => void
  readonly once: (event: 'close', listener: () => void) => void
}>

export type PearRuntime = Readonly<{
  readonly close: () => Promise<void>
  readonly ready: () => Promise<void>
  readonly run: (entrypoint: BareWorkerEntrypoint, args?: readonly string[]) => PearSidecar
}>

export type PearRuntimeFactory = (
  options: Readonly<{ readonly dir: PearDataDirectory }>,
) => PearRuntime

export type PearCapabilityWorker = ParticipantWorker &
  Readonly<{
    readonly advertise: (frame: Uint8Array) => Effect.Effect<void, WorkerStartFailure>
  }>

type PearLifecycle = 'created' | 'starting' | 'running' | 'stopping' | 'stopped'

const readyMessage = 'ready'
const startupFailurePrefix = 'startup-failed:'
const maximumStartupFrameBytes = 1024

const workerStartFailure = (reason: string): WorkerStartFailure => ({
  _tag: 'worker-start-failed',
  reason: FailureReason(reason),
})

const workerShutdownFailure = (reason: string): WorkerShutdownFailure => ({
  _tag: 'worker-shutdown-failed',
  reason: FailureReason(reason),
})

const startSidecar = (
  sidecar: PearSidecar,
  peerFrameAdmission: PeerFrameAdmission | undefined,
  onAcceptedPeerEnvelope: ((envelope: ProtocolEnvelope) => void) | undefined,
): Effect.Effect<void, WorkerStartFailure> =>
  Effect.async((resume) => {
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    let buffered = ''
    let peerFrames = new Uint8Array()
    let ready = false

    const fail = (reason: string): void => {
      resume(Effect.fail(workerStartFailure(reason)))
    }

    const receivePeerFrames = (data: Uint8Array): void => {
      const combined = new Uint8Array(peerFrames.byteLength + data.byteLength)
      combined.set(peerFrames)
      combined.set(data, peerFrames.byteLength)
      peerFrames = combined
      if (peerFrames.byteLength > 65_541) {
        peerFrames = new Uint8Array()
        return
      }

      while (peerFrames.byteLength >= 5) {
        const length = new DataView(peerFrames.buffer, peerFrames.byteOffset + 1, 4).getUint32(0)
        if (peerFrames[0] !== 2 || length > 65_536) {
          peerFrames = new Uint8Array()
          return
        }
        if (peerFrames.byteLength < length + 5) return
        const frame = peerFrames.slice(5, length + 5)
        peerFrames = peerFrames.slice(length + 5)
        const admitted = peerFrameAdmission?.(frame)
        if (admitted?.ok) onAcceptedPeerEnvelope?.(admitted.value)
      }
    }

    const onData = (data: Uint8Array): void => {
      if (ready) {
        receivePeerFrames(data)
        return
      }

      buffered += decoder.decode(data, { stream: true })

      if (encoder.encode(buffered).byteLength > maximumStartupFrameBytes) {
        fail('Pear worker startup frame exceeded 1024 bytes')
        return
      }

      const newline = buffered.indexOf('\n')

      if (newline < 0) {
        return
      }

      const frame = buffered.slice(0, newline)

      if (frame === readyMessage) {
        ready = true
        resume(Effect.void)
        return
      }

      if (frame.startsWith(startupFailurePrefix)) {
        const reason = frame.slice(startupFailurePrefix.length).trim()
        fail(reason.length > 0 ? reason : 'Pear worker reported an invalid failure')
        return
      }

      fail('Pear worker reported an invalid startup frame')
    }

    sidecar.once('close', () => {
      fail('Pear worker closed before reporting readiness')
    })
    sidecar.on('data', onData)
  })

const createDefaultRuntime: PearRuntimeFactory = (options) => new PearRuntimeHost(options)

export const createPearWorker = (
  {
    dataDirectory,
    localDhtBootstrap,
    localDiscoveryRole,
    onAcceptedPeerEnvelope,
    peerFrameAdmission,
    startupTimeout,
    workerEntrypoint,
  }: PearWorkerOptions,
  createRuntime: PearRuntimeFactory = createDefaultRuntime,
): PearCapabilityWorker => {
  let lifecycle: PearLifecycle = 'created'
  let runtime: PearRuntime | undefined
  let sidecar: PearSidecar | undefined
  let shutdownEffect: Effect.Effect<void, WorkerShutdownFailure> | undefined

  const shutdown = (): Effect.Effect<void, WorkerShutdownFailure> => {
    if (shutdownEffect !== undefined) {
      return shutdownEffect
    }

    const cleanup = Effect.suspend(() => {
      if (lifecycle === 'stopped') {
        return Effect.void
      }

      lifecycle = 'stopping'
      const sidecarToClose = sidecar
      const runtimeToClose = runtime

      return Effect.gen(function* () {
        const sidecarResult = yield* Effect.either(
          sidecarToClose === undefined
            ? Effect.void
            : Effect.try({
                try: () => {
                  sidecarToClose.destroy()
                },
                catch: () => workerShutdownFailure('could not stop Pear worker'),
              }),
        )

        if (Either.isRight(sidecarResult)) {
          sidecar = undefined
        }

        const runtimeResult = yield* Effect.either(
          runtimeToClose === undefined
            ? Effect.void
            : Effect.tryPromise({
                try: () => runtimeToClose.close(),
                catch: () => workerShutdownFailure('could not close Pear runtime'),
              }),
        )

        if (Either.isRight(runtimeResult)) {
          runtime = undefined
        }

        if (Either.isLeft(sidecarResult)) {
          return yield* Effect.fail(sidecarResult.left)
        }

        if (Either.isLeft(runtimeResult)) {
          return yield* Effect.fail(runtimeResult.left)
        }

        lifecycle = 'stopped'
      })
    })

    const cachedCleanup = Effect.runSync(Effect.cached(cleanup))
    shutdownEffect = cachedCleanup.pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          shutdownEffect = undefined
        }),
      ),
    )
    return shutdownEffect
  }

  const cleanFailedStart = (
    failure: WorkerStartFailure,
  ): Effect.Effect<never, WorkerStartFailure> =>
    Effect.zipRight(Effect.either(shutdown()), Effect.fail(failure))

  const advertise = (frame: Uint8Array): Effect.Effect<void, WorkerStartFailure> =>
    Effect.suspend(() => {
      const sidecarToAdvertise = sidecar
      const write = sidecarToAdvertise?.write
      if (lifecycle !== 'running' || sidecarToAdvertise === undefined || write === undefined) {
        return Effect.fail(workerStartFailure('Pear worker is not ready to advertise'))
      }

      if (frame.byteLength > 65_536) {
        return Effect.fail(workerStartFailure('Pear advertisement frame exceeded 65536 bytes'))
      }

      const command = new Uint8Array(frame.byteLength + 5)
      command[0] = 1
      new DataView(command.buffer).setUint32(1, frame.byteLength)
      command.set(frame, 5)

      return Effect.try({
        try: () => {
          write.call(sidecarToAdvertise, command)
        },
        catch: () => workerStartFailure('could not write advertisement to Pear worker'),
      })
    })

  const start: Effect.Effect<void, WorkerStartFailure> = Effect.suspend(() => {
    if (lifecycle !== 'created') {
      return Effect.fail(workerStartFailure('Pear worker cannot start after shutdown'))
    }

    lifecycle = 'starting'

    return Effect.catchAll(
      Effect.gen(function* () {
        const createdRuntime = yield* Effect.try({
          try: () => createRuntime({ dir: dataDirectory }),
          catch: () => workerStartFailure('could not create Pear runtime'),
        })
        runtime = createdRuntime

        yield* Effect.tryPromise({
          try: () => createdRuntime.ready(),
          catch: () => workerStartFailure('Pear runtime did not become ready'),
        }).pipe(
          Effect.timeoutFail({
            duration: startupTimeout,
            onTimeout: () => workerStartFailure('Pear runtime readiness timed out'),
          }),
        )

        if (lifecycle !== 'starting') {
          return yield* Effect.fail(workerStartFailure('Pear worker was shut down during startup'))
        }

        const createdSidecar = yield* Effect.try({
          try: () =>
            createdRuntime.run(workerEntrypoint, [
              ...(localDhtBootstrap === undefined ? [] : [localDhtBootstrap]),
              ...(localDiscoveryRole === undefined ? [] : [localDiscoveryRole]),
            ]),
          catch: () => workerStartFailure('could not start Pear worker'),
        })
        sidecar = createdSidecar

        yield* startSidecar(createdSidecar, peerFrameAdmission, onAcceptedPeerEnvelope).pipe(
          Effect.timeoutFail({
            duration: startupTimeout,
            onTimeout: () => workerStartFailure('Pear worker readiness timed out'),
          }),
        )

        const lifecycleAfterStartup = yield* Effect.sync(() => lifecycle)

        if (lifecycleAfterStartup !== 'starting') {
          return yield* Effect.fail(workerStartFailure('Pear worker was shut down during startup'))
        }

        lifecycle = 'running'
      }),
      cleanFailedStart,
    )
  })

  return { advertise, start, shutdown: shutdown() }
}

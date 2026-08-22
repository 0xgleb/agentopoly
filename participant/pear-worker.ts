import * as Brand from "effect/Brand"
import * as Effect from "effect/Effect"
import PearRuntimeHost from "pear-runtime"

import {
  FailureReason,
  type ParticipantWorker,
  type WorkerShutdownFailure,
  type WorkerStartFailure,
} from "./participant.ts"

export type PearDataDirectory = string & Brand.Brand<"PearDataDirectory">
export const PearDataDirectory = Brand.refined<PearDataDirectory>(
  (value) => value.trim().length > 0 && value.length <= 1024,
  () => Brand.error("Pear data directory must be non-empty"),
)

export type BareWorkerEntrypoint = string & Brand.Brand<"BareWorkerEntrypoint">
export const BareWorkerEntrypoint = Brand.refined<BareWorkerEntrypoint>(
  (value) => value.trim().length > 0 && value.length <= 1024,
  () => Brand.error("Bare worker entrypoint must be non-empty"),
)

export type PearWorkerOptions = Readonly<{
  readonly dataDirectory: PearDataDirectory
  readonly workerEntrypoint: BareWorkerEntrypoint
}>

export type PearSidecar = Readonly<{
  readonly destroy: () => void
  readonly on: (event: "data", listener: (data: Uint8Array) => void) => void
  readonly once: (event: "close", listener: () => void) => void
}>

export type PearRuntime = Readonly<{
  readonly close: () => Promise<void>
  readonly ready: () => Promise<void>
  readonly run: (entrypoint: BareWorkerEntrypoint) => PearSidecar
}>

export type PearRuntimeFactory = (options: Readonly<{ readonly dir: PearDataDirectory }>) => PearRuntime

const readyMessage = "ready\n"
const startupFailurePrefix = "startup-failed:"

const workerStartFailure = (reason: string): WorkerStartFailure => ({
  _tag: "worker-start-failed",
  reason: FailureReason(reason),
})

const workerShutdownFailure = (reason: string): WorkerShutdownFailure => ({
  _tag: "worker-shutdown-failed",
  reason: FailureReason(reason),
})

const readStartupMessage = (data: Uint8Array): string => new TextDecoder().decode(data)

const startSidecar = (sidecar: PearSidecar): Effect.Effect<void, WorkerStartFailure> =>
  Effect.async((resume) => {
    const onData = (data: Uint8Array): void => {
      const message = readStartupMessage(data)

      if (message === readyMessage) {
        resume(Effect.void)
        return
      }

      if (message.startsWith(startupFailurePrefix)) {
        const reason = message.slice(startupFailurePrefix.length).trim()
        resume(
          Effect.fail(
            workerStartFailure(reason.length > 0 ? reason : "Pear worker reported an invalid failure"),
          ),
        )
      }
    }

    sidecar.once("close", () => {
      resume(Effect.fail(workerStartFailure("Pear worker closed before reporting readiness")))
    })
    sidecar.on("data", onData)
  })

const createDefaultRuntime: PearRuntimeFactory = (options) => new PearRuntimeHost(options)

export const createPearWorker = (
  { dataDirectory, workerEntrypoint }: PearWorkerOptions,
  createRuntime: PearRuntimeFactory = createDefaultRuntime,
): ParticipantWorker => {
  let runtime: PearRuntime | undefined
  let sidecar: PearSidecar | undefined
  let shutdownStarted = false
  let startStarted = false

  const shutdown: Effect.Effect<void, WorkerShutdownFailure> = Effect.suspend(() => {
    if (shutdownStarted) {
      return Effect.void
    }

    shutdownStarted = true
    const sidecarToClose = sidecar
    const runtimeToClose = runtime
    sidecar = undefined
    runtime = undefined

    return Effect.gen(function* () {
      yield* Effect.try({
        try: () => sidecarToClose?.destroy(),
        catch: () => workerShutdownFailure("could not stop Pear worker"),
      })

      if (runtimeToClose !== undefined) {
        yield* Effect.tryPromise({
          try: () => runtimeToClose.close(),
          catch: () => workerShutdownFailure("could not close Pear runtime"),
        })
      }
    })
  })

  const start: Effect.Effect<void, WorkerStartFailure> = Effect.suspend(() => {
    if (startStarted || shutdownStarted) {
      return Effect.fail(workerStartFailure("Pear worker cannot start after shutdown"))
    }

    startStarted = true

    return Effect.gen(function* () {
      const createdRuntime = yield* Effect.try({
        try: () => createRuntime({ dir: dataDirectory }),
        catch: () => workerStartFailure("could not create Pear runtime"),
      })
      runtime = createdRuntime

      yield* Effect.tryPromise({
        try: () => createdRuntime.ready(),
        catch: () => workerStartFailure("Pear runtime did not become ready"),
      })

      const createdSidecar = yield* Effect.try({
        try: () => createdRuntime.run(workerEntrypoint),
        catch: () => workerStartFailure("could not start Pear worker"),
      })
      sidecar = createdSidecar

      yield* startSidecar(createdSidecar)
    })
  })

  return { start, shutdown }
}

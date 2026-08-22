import PearRuntimeHost from "pear-runtime"

import type { ParticipantWorker, WorkerStartResult } from "./participant.ts"

export type PearWorkerOptions = Readonly<{
  readonly dataDirectory: string
  readonly workerEntrypoint: string
}>

export type PearSidecar = Readonly<{
  readonly destroy: () => void
  readonly on: (event: "data", listener: (data: Uint8Array) => void) => void
  readonly once: (event: "close", listener: () => void) => void
}>

export type PearRuntime = Readonly<{
  readonly close: () => Promise<void>
  readonly ready: () => Promise<void>
  readonly run: (entrypoint: string) => PearSidecar
}>

export type PearRuntimeFactory = (options: Readonly<{ readonly dir: string }>) => PearRuntime

const readyMessage = "ready\n"
const startupFailurePrefix = "startup-failed:"

const readStartupMessage = (data: Uint8Array): string => new TextDecoder().decode(data)

const startSidecar = (sidecar: PearSidecar): Promise<WorkerStartResult> =>
  new Promise((resolve) => {
    const onData = (data: Uint8Array): void => {
      const message = readStartupMessage(data)

      if (message === readyMessage) {
        resolve({ _tag: "success" })
        return
      }

      if (message.startsWith(startupFailurePrefix)) {
        resolve({
          _tag: "failure",
          reason: message.slice(startupFailurePrefix.length).trim(),
        })
      }
    }

    sidecar.once("close", () => {
      resolve({
        _tag: "failure",
        reason: "Pear worker closed before reporting readiness",
      })
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
  let shutdownPromise: Promise<void> | undefined

  return {
    start: async (): Promise<WorkerStartResult> => {
      if (shutdownPromise !== undefined) {
        return { _tag: "failure", reason: "Pear worker was shut down" }
      }

      runtime = createRuntime({ dir: dataDirectory })
      await runtime.ready()
      sidecar = runtime.run(workerEntrypoint)
      return startSidecar(sidecar)
    },
    shutdown: (): Promise<void> => {
      if (shutdownPromise !== undefined) {
        return shutdownPromise
      }

      const sidecarToClose = sidecar
      const runtimeToClose = runtime
      sidecar = undefined
      runtime = undefined

      shutdownPromise = (async (): Promise<void> => {
        sidecarToClose?.destroy()

        if (runtimeToClose !== undefined) {
          await runtimeToClose.close()
        }
      })()

      return shutdownPromise
    },
  }
}

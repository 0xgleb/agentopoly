import { describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"

import {
  BareWorkerEntrypoint,
  createPearWorker,
  PearDataDirectory,
  type PearRuntime,
  type PearRuntimeFactory,
  type PearSidecar,
} from "./pear-worker.ts"

const createReadySidecar = () => {
  let dataListener: ((data: Uint8Array) => void) | undefined
  let closeListener: (() => void) | undefined
  let destroys = 0

  const sidecar: PearSidecar = {
    destroy: () => {
      destroys += 1
    },
    on: (_event, listener) => {
      dataListener = listener
    },
    once: (_event, listener) => {
      closeListener = listener
    },
  }

  return {
    emitClosed: () => closeListener?.(),
    emitReady: () => dataListener?.(new TextEncoder().encode("ready\n")),
    sidecar,
    getDestroys: () => destroys,
  }
}

describe("Pear worker boundary", () => {
  test("starts the local Bare worker and releases every Pear resource on shutdown", async () => {
    const fakeSidecar = createReadySidecar()
    let closed = 0
    let readyCalls = 0
    let workerEntrypoint = ""
    let runtimeDirectory = ""

    const createRuntime: PearRuntimeFactory = (options): PearRuntime => {
      runtimeDirectory = options.dir

      return {
        close: async () => {
          closed += 1
        },
        ready: async () => {
          readyCalls += 1
        },
        run: (entrypoint) => {
          workerEntrypoint = entrypoint
          queueMicrotask(fakeSidecar.emitReady)
          return fakeSidecar.sidecar
        },
      }
    }

    const worker = createPearWorker(
      {
        dataDirectory: PearDataDirectory("/local/participant-data"),
        workerEntrypoint: BareWorkerEntrypoint("participant/worker.js"),
      },
      createRuntime,
    )

    await Effect.runPromise(worker.start)
    await Promise.all([Effect.runPromise(worker.shutdown), Effect.runPromise(worker.shutdown)])

    expect(readyCalls).toBe(1)
    expect(workerEntrypoint).toBe("participant/worker.js")
    expect(runtimeDirectory).toBe("/local/participant-data")
    expect(fakeSidecar.getDestroys()).toBe(1)
    expect(closed).toBe(1)
  })

  test("returns a typed failure when the Bare worker closes before readiness", async () => {
    const fakeSidecar = createReadySidecar()

    const createRuntime = (): PearRuntime => ({
      close: async () => undefined,
      ready: async () => undefined,
      run: () => {
        queueMicrotask(fakeSidecar.emitClosed)
        return fakeSidecar.sidecar
      },
    })

    const worker = createPearWorker(
      {
        dataDirectory: PearDataDirectory("/local/participant-data"),
        workerEntrypoint: BareWorkerEntrypoint("participant/worker.js"),
      },
      createRuntime,
    )

    const result = await Effect.runPromise(Effect.either(worker.start))

    expect(result).toMatchObject({
      _tag: "Left",
      left: {
        _tag: "worker-start-failed",
        reason: "Pear worker closed before reporting readiness",
      },
    })
  })
})

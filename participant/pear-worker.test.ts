import { describe, expect, test } from "bun:test"

import { createPearWorker, type PearRuntime, type PearSidecar } from "./pear-worker.ts"

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

    const createRuntime = (options: Readonly<{ readonly dir: string }>): PearRuntime => {
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
        dataDirectory: "/local/participant-data",
        workerEntrypoint: "participant/worker.js",
      },
      createRuntime,
    )

    expect(await worker.start()).toEqual({ _tag: "success" })
    await Promise.all([worker.shutdown(), worker.shutdown()])

    expect(readyCalls).toBe(1)
    expect(workerEntrypoint).toBe("participant/worker.js")
    expect(runtimeDirectory).toBe("/local/participant-data")
    expect(fakeSidecar.getDestroys()).toBe(1)
    expect(closed).toBe(1)
  })

  test("fails startup when the Bare worker closes before readiness", async () => {
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
        dataDirectory: "/local/participant-data",
        workerEntrypoint: "participant/worker.js",
      },
      createRuntime,
    )

    expect(await worker.start()).toEqual({
      _tag: "failure",
      reason: "Pear worker closed before reporting readiness",
    })
  })
})

import { describe, expect, test } from 'bun:test'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'

import {
  BareWorkerEntrypoint,
  createPearWorker,
  PearDataDirectory,
  type PearRuntime,
  type PearRuntimeFactory,
  type PearSidecar,
} from './pear-worker.ts'

const createReadySidecar = () => {
  let dataListener: ((data: Uint8Array) => void) | undefined
  let closeListener: (() => void) | undefined
  let closeQueued = false
  let destroys = 0
  const queuedData: (string | Uint8Array)[] = []
  const writes: Uint8Array[] = []

  const emit = (message: string | Uint8Array): void => {
    if (dataListener === undefined) {
      queuedData.push(message)
      return
    }

    dataListener(typeof message === 'string' ? new TextEncoder().encode(message) : message)
  }

  const sidecar: PearSidecar = {
    destroy: () => {
      destroys += 1
    },
    on: (_event, listener) => {
      dataListener = listener
      queuedData.splice(0).forEach(emit)
    },
    once: (_event, listener) => {
      closeListener = listener

      if (closeQueued) {
        closeListener()
      }
    },
    write: (data) => {
      writes.push(data)
    },
  }

  return {
    emit,
    emitClosed: () => {
      if (closeListener === undefined) {
        closeQueued = true
        return
      }

      closeListener()
    },
    emitReady: () => {
      emit('ready\n')
    },
    sidecar,
    getDestroys: () => destroys,
    getWrites: () => writes,
  }
}

describe('Pear worker boundary', () => {
  test('starts the local Bare worker and releases every Pear resource on shutdown', async () => {
    const fakeSidecar = createReadySidecar()
    let closed = 0
    let readyCalls = 0
    let workerEntrypoint = ''
    let runtimeDirectory = ''

    const createRuntime: PearRuntimeFactory = (options): PearRuntime => {
      runtimeDirectory = options.dir

      return {
        close: () => {
          closed += 1
          return Promise.resolve()
        },
        ready: () => {
          readyCalls += 1
          return Promise.resolve()
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
        dataDirectory: PearDataDirectory('/local/participant-data'),
        startupTimeout: Duration.seconds(1),
        workerEntrypoint: BareWorkerEntrypoint('participant/worker.js'),
      },
      createRuntime,
    )

    await Effect.runPromise(worker.start)
    await Promise.all([Effect.runPromise(worker.shutdown), Effect.runPromise(worker.shutdown)])

    expect(readyCalls).toBe(1)
    expect(workerEntrypoint).toBe('participant/worker.js')
    expect(runtimeDirectory).toBe('/local/participant-data')
    expect(fakeSidecar.getDestroys()).toBe(1)
    expect(closed).toBe(1)
  })

  test('refuses to advertise before the Bare worker is ready', async () => {
    const fakeSidecar = createReadySidecar()
    const createRuntime = (): PearRuntime => ({
      close: () => Promise.resolve(),
      ready: () => Promise.resolve(),
      run: () => fakeSidecar.sidecar,
    })
    const worker = createPearWorker(
      {
        dataDirectory: PearDataDirectory('/local/participant-data'),
        startupTimeout: Duration.seconds(1),
        workerEntrypoint: BareWorkerEntrypoint('participant/worker.js'),
      },
      createRuntime,
    )

    const result = await Effect.runPromise(Effect.either(worker.advertise(Uint8Array.of(1))))

    expect(result).toMatchObject({
      _tag: 'Left',
      left: { _tag: 'worker-start-failed', reason: 'Pear worker is not ready to advertise' },
    })
  })

  test('writes a bounded framed advertisement only after the Bare worker is ready', async () => {
    const fakeSidecar = createReadySidecar()
    const createRuntime = (): PearRuntime => ({
      close: () => Promise.resolve(),
      ready: () => Promise.resolve(),
      run: () => {
        queueMicrotask(fakeSidecar.emitReady)
        return fakeSidecar.sidecar
      },
    })
    const worker = createPearWorker(
      {
        dataDirectory: PearDataDirectory('/local/participant-data'),
        startupTimeout: Duration.seconds(1),
        workerEntrypoint: BareWorkerEntrypoint('participant/worker.js'),
      },
      createRuntime,
    )

    await Effect.runPromise(worker.start)
    await Effect.runPromise(worker.advertise(Uint8Array.of(1, 2)))

    expect(Array.from(fakeSidecar.getWrites()[0] ?? [])).toEqual([1, 0, 0, 0, 2, 1, 2])
  })

  test('sends a bounded peer frame to the injected protocol admission boundary', async () => {
    const fakeSidecar = createReadySidecar()
    const admittedFrames: Uint8Array[] = []
    const createRuntime = (): PearRuntime => ({
      close: () => Promise.resolve(),
      ready: () => Promise.resolve(),
      run: () => {
        queueMicrotask(fakeSidecar.emitReady)
        return fakeSidecar.sidecar
      },
    })
    const worker = createPearWorker(
      {
        dataDirectory: PearDataDirectory('/local/participant-data'),
        peerFrameAdmission: (frame) => {
          admittedFrames.push(frame)
          return { ok: false, error: 'malformed-encoding' }
        },
        startupTimeout: Duration.seconds(1),
        workerEntrypoint: BareWorkerEntrypoint('participant/worker.js'),
      },
      createRuntime,
    )

    await Effect.runPromise(worker.start)
    fakeSidecar.emit(Uint8Array.of(2, 0, 0, 0, 2, 8, 9))

    expect(admittedFrames.map((frame) => Array.from(frame))).toEqual([[8, 9]])
  })

  test('drops a worker frame with an unsigned length above the protocol cap', async () => {
    const fakeSidecar = createReadySidecar()
    const admittedFrames: Uint8Array[] = []
    const createRuntime = (): PearRuntime => ({
      close: () => Promise.resolve(),
      ready: () => Promise.resolve(),
      run: () => {
        queueMicrotask(fakeSidecar.emitReady)
        return fakeSidecar.sidecar
      },
    })
    const worker = createPearWorker(
      {
        dataDirectory: PearDataDirectory('/local/participant-data'),
        peerFrameAdmission: (frame) => {
          admittedFrames.push(frame)
          return { ok: false, error: 'malformed-encoding' }
        },
        startupTimeout: Duration.seconds(1),
        workerEntrypoint: BareWorkerEntrypoint('participant/worker.js'),
      },
      createRuntime,
    )

    await Effect.runPromise(worker.start)
    fakeSidecar.emit(Uint8Array.of(2, 255, 255, 255, 255))

    expect(admittedFrames).toEqual([])
  })

  test('accepts a split readiness frame from the Bare worker', async () => {
    const fakeSidecar = createReadySidecar()

    const createRuntime = (): PearRuntime => ({
      close: () => Promise.resolve(),
      ready: () => Promise.resolve(),
      run: () => {
        queueMicrotask(() => {
          fakeSidecar.emit('rea')
          fakeSidecar.emit('dy\n')
        })
        return fakeSidecar.sidecar
      },
    })

    const worker = createPearWorker(
      {
        dataDirectory: PearDataDirectory('/local/participant-data'),
        startupTimeout: Duration.seconds(1),
        workerEntrypoint: BareWorkerEntrypoint('participant/worker.js'),
      },
      createRuntime,
    )

    await Effect.runPromise(worker.start)
  })

  test('does not create a sidecar after shutdown begins during runtime startup', async () => {
    const fakeSidecar = createReadySidecar()
    let releaseReady: (() => void) | undefined
    let runCalls = 0

    const createRuntime = (): PearRuntime => ({
      close: () => Promise.resolve(),
      ready: () =>
        new Promise((resolve) => {
          releaseReady = resolve
        }),
      run: () => {
        runCalls += 1
        return fakeSidecar.sidecar
      },
    })

    const worker = createPearWorker(
      {
        dataDirectory: PearDataDirectory('/local/participant-data'),
        startupTimeout: Duration.seconds(1),
        workerEntrypoint: BareWorkerEntrypoint('participant/worker.js'),
      },
      createRuntime,
    )

    const startup = Effect.runPromise(Effect.either(worker.start))
    await Effect.runPromise(Effect.yieldNow())
    await Effect.runPromise(worker.shutdown)

    expect(releaseReady).toBeDefined()

    if (releaseReady !== undefined) {
      releaseReady()
    }

    const result = await startup

    expect(result).toMatchObject({
      _tag: 'Left',
      left: {
        _tag: 'worker-start-failed',
        reason: 'Pear worker was shut down during startup',
      },
    })
    expect(runCalls).toBe(0)
  })

  test('times out a silent Bare worker and cleans its Pear resources', async () => {
    const fakeSidecar = createReadySidecar()
    let closed = 0

    const createRuntime = (): PearRuntime => ({
      close: () => {
        closed += 1
        return Promise.resolve()
      },
      ready: () => Promise.resolve(),
      run: () => fakeSidecar.sidecar,
    })

    const worker = createPearWorker(
      {
        dataDirectory: PearDataDirectory('/local/participant-data'),
        startupTimeout: Duration.millis(1),
        workerEntrypoint: BareWorkerEntrypoint('participant/worker.js'),
      },
      createRuntime,
    )

    const result = await Effect.runPromise(Effect.either(worker.start))

    expect(result).toMatchObject({
      _tag: 'Left',
      left: {
        _tag: 'worker-start-failed',
        reason: 'Pear worker readiness timed out',
      },
    })
    expect(fakeSidecar.getDestroys()).toBe(1)
    expect(closed).toBe(1)
  })

  test('returns a typed failure when the Bare worker closes before readiness', async () => {
    const fakeSidecar = createReadySidecar()

    const createRuntime = (): PearRuntime => ({
      close: () => Promise.resolve(),
      ready: () => Promise.resolve(),
      run: () => {
        queueMicrotask(fakeSidecar.emitClosed)
        return fakeSidecar.sidecar
      },
    })

    const worker = createPearWorker(
      {
        dataDirectory: PearDataDirectory('/local/participant-data'),
        startupTimeout: Duration.seconds(1),
        workerEntrypoint: BareWorkerEntrypoint('participant/worker.js'),
      },
      createRuntime,
    )

    const result = await Effect.runPromise(Effect.either(worker.start))

    expect(result).toMatchObject({
      _tag: 'Left',
      left: {
        _tag: 'worker-start-failed',
        reason: 'Pear worker closed before reporting readiness',
      },
    })
  })
})

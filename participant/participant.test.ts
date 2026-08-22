import { describe, expect, test } from "bun:test"

import { createParticipant, type WorkerStartResult } from "./participant.ts"

type LifecycleObservation = {
  identityCreates: number
  savedStates: number
  workerShutdowns: number
  workerStarts: number
}

const validConfig = {
  displayName: "Reliable provider",
  role: "provider",
  runtimeVersion: "1.3.1",
}

const createHarness = (
  config: unknown,
  persistedState: unknown,
  startWorker: () => Promise<WorkerStartResult> = async () => ({ _tag: "success" }),
) => {
  const observation: LifecycleObservation = {
    identityCreates: 0,
    savedStates: 0,
    workerShutdowns: 0,
    workerStarts: 0,
  }

  const participant = createParticipant({
    config,
    identitySource: {
      create: async () => {
        observation.identityCreates += 1
        return "participant-public-key"
      },
    },
    stateStore: {
      load: async () => persistedState,
      save: async () => {
        observation.savedStates += 1
      },
    },
    worker: {
      start: async () => {
        observation.workerStarts += 1
        return startWorker()
      },
      shutdown: async () => {
        observation.workerShutdowns += 1
      },
    },
  })

  return { observation, participant }
}

describe("participant lifecycle", () => {
  test("starts a participant with its public identity and role projection", async () => {
    const { observation, participant } = createHarness(validConfig, undefined)

    const result = await participant.start()

    expect(result).toEqual({
      _tag: "success",
      value: {
        displayName: "Reliable provider",
        health: "ready",
        identity: "participant-public-key",
        role: "provider",
        runtimeVersion: "1.3.1",
      },
    })
    expect(observation.savedStates).toBe(1)
  })

  test("reuses a validated persisted public identity", async () => {
    const { observation, participant } = createHarness(validConfig, {
      identity: "persisted-public-key",
    })

    const result = await participant.start()

    expect(result).toEqual({
      _tag: "success",
      value: {
        displayName: "Reliable provider",
        health: "ready",
        identity: "persisted-public-key",
        role: "provider",
        runtimeVersion: "1.3.1",
      },
    })
    expect(observation).toEqual({
      identityCreates: 0,
      savedStates: 0,
      workerShutdowns: 0,
      workerStarts: 1,
    })
  })

  test("rejects malformed configuration without starting a worker", async () => {
    const { observation, participant } = createHarness(
      { ...validConfig, role: "wallet-operator" },
      undefined,
    )

    const result = await participant.start()

    expect(result).toEqual({
      _tag: "failure",
      error: {
        _tag: "invalid-config",
        reason: "role must be buyer, provider, or arbitrator",
      },
    })
    expect(observation).toEqual({
      identityCreates: 0,
      savedStates: 0,
      workerShutdowns: 0,
      workerStarts: 0,
    })
  })

  test("fails closed on malformed persisted state without starting a worker", async () => {
    const { observation, participant } = createHarness(validConfig, { identity: 17 })

    const result = await participant.start()

    expect(result).toEqual({
      _tag: "failure",
      error: {
        _tag: "invalid-persisted-state",
        reason: "identity must be a non-empty public identifier",
      },
    })
    expect(observation.workerStarts).toBe(0)
  })

  test("reports worker startup failure and shuts the failed worker down", async () => {
    const { observation, participant } = createHarness(
      validConfig,
      undefined,
      async () => ({
        _tag: "failure",
        reason: "worker did not become ready",
      }),
    )

    const result = await participant.start()

    expect(result).toEqual({
      _tag: "failure",
      error: {
        _tag: "worker-start-failed",
        reason: "worker did not become ready",
      },
    })
    expect(observation.workerShutdowns).toBe(1)
  })

  test("does not start a participant after shutdown", async () => {
    const { observation, participant } = createHarness(validConfig, undefined)

    await participant.shutdown()

    expect(await participant.start()).toEqual({
      _tag: "failure",
      error: {
        _tag: "participant-stopped",
        reason: "participant was shut down before becoming ready",
      },
    })
    expect(observation.workerStarts).toBe(0)
  })

  test("shuts down exactly once when shutdown is requested repeatedly", async () => {
    const { observation, participant } = createHarness(validConfig, undefined)

    await participant.start()
    await Promise.all([participant.shutdown(), participant.shutdown()])

    expect(observation.workerShutdowns).toBe(1)
  })
})

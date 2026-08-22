import { describe, expect, test } from "bun:test"
import * as Either from "effect/Either"
import * as Effect from "effect/Effect"

import {
  createParticipant,
  DisplayName,
  FailureReason,
  ParticipantIdentity,
  RuntimeVersion,
  type WorkerStartFailure,
} from "./participant.ts"

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

const expectFailure = async <A>(effect: Effect.Effect<A, unknown>, failure: unknown) => {
  const result = await Effect.runPromise(Effect.either(effect))

  expect(Either.isLeft(result)).toBe(true)

  if (Either.isLeft(result)) {
    expect(result.left).toEqual(failure)
  }
}

const createHarness = (
  config: unknown,
  persistedState: unknown,
  startWorker: Effect.Effect<void, WorkerStartFailure> = Effect.void,
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
      create: Effect.sync(() => {
        observation.identityCreates += 1
        return ParticipantIdentity("participant-public-key")
      }),
      verifyPersisted: (identity) => Effect.succeed(identity),
    },
    stateStore: {
      load: Effect.succeed(persistedState),
      save: () =>
        Effect.sync(() => {
          observation.savedStates += 1
        }),
    },
    worker: {
      start: Effect.zipRight(
        Effect.sync(() => {
          observation.workerStarts += 1
        }),
        startWorker,
      ),
      shutdown: Effect.sync(() => {
        observation.workerShutdowns += 1
      }),
    },
  })

  return { observation, participant }
}

describe("participant lifecycle", () => {
  test("accepts at most 256 UTF-8 bytes for a participant identity", () => {
    expect(Either.isRight(ParticipantIdentity.either("😀".repeat(64)))).toBe(true)
    expect(Either.isLeft(ParticipantIdentity.either("😀".repeat(65)))).toBe(true)
  })

  test("starts a participant with its public identity and role projection", async () => {
    const { observation, participant } = createHarness(validConfig, undefined)

    const result = await Effect.runPromise(participant.start())

    expect(result).toEqual({
      displayName: DisplayName("Reliable provider"),
      health: "ready",
      identity: ParticipantIdentity("participant-public-key"),
      role: "provider",
      runtimeVersion: RuntimeVersion("1.3.1"),
    })
    expect(observation.savedStates).toBe(1)
  })

  test("reuses a validated persisted public identity", async () => {
    const { observation, participant } = createHarness(validConfig, {
      identity: "persisted-public-key",
    })

    const result = await Effect.runPromise(participant.start())

    expect(result).toEqual({
      displayName: DisplayName("Reliable provider"),
      health: "ready",
      identity: ParticipantIdentity("persisted-public-key"),
      role: "provider",
      runtimeVersion: RuntimeVersion("1.3.1"),
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

    await expectFailure(participant.start(), {
      _tag: "invalid-config",
      reason: "role must be buyer, provider, or arbitrator",
    })
    expect(observation).toEqual({
      identityCreates: 0,
      savedStates: 0,
      workerShutdowns: 0,
      workerStarts: 0,
    })
  })

  test("returns a typed failure when the persisted-state boundary fails", async () => {
    const participant = createParticipant({
      config: validConfig,
      identitySource: {
        create: Effect.succeed(ParticipantIdentity("participant-public-key")),
        verifyPersisted: (identity) => Effect.succeed(identity),
      },
      stateStore: {
        load: Effect.fail({
          _tag: "state-store-failed",
          reason: FailureReason("state unavailable"),
        }),
        save: () => Effect.void,
      },
      worker: {
        start: Effect.void,
        shutdown: Effect.void,
      },
    })

    await expectFailure(participant.start(), {
      _tag: "state-store-failed",
      reason: "state unavailable",
    })
  })

  test("fails closed on malformed persisted state without starting a worker", async () => {
    const { observation, participant } = createHarness(validConfig, { identity: 17 })

    await expectFailure(participant.start(), {
      _tag: "invalid-persisted-state",
      reason: "identity must be a non-empty public identifier",
    })
    expect(observation.workerStarts).toBe(0)
  })

  test("reports worker startup failure and shuts the failed worker down", async () => {
    const { observation, participant } = createHarness(
      validConfig,
      undefined,
      Effect.fail({
        _tag: "worker-start-failed",
        reason: FailureReason("worker did not become ready"),
      }),
    )

    await expectFailure(participant.start(), {
      _tag: "worker-start-failed",
      reason: "worker did not become ready",
    })
    expect(observation.workerShutdowns).toBe(1)
  })

  test("does not start a participant after shutdown", async () => {
    const { observation, participant } = createHarness(validConfig, undefined)

    await Effect.runPromise(participant.shutdown())

    await expectFailure(participant.start(), {
      _tag: "participant-stopped",
      reason: "participant was shut down before becoming ready",
    })
    expect(observation.workerStarts).toBe(0)
  })

  test("shuts down exactly once when shutdown is requested repeatedly", async () => {
    const { observation, participant } = createHarness(validConfig, undefined)

    await Effect.runPromise(participant.start())
    await Promise.all([
      Effect.runPromise(participant.shutdown()),
      Effect.runPromise(participant.shutdown()),
    ])

    expect(observation.workerShutdowns).toBe(1)
  })
})

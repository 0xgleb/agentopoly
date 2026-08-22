export type ParticipantRole = "buyer" | "provider" | "arbitrator"

export type ParticipantProjection = Readonly<{
  readonly displayName: string
  readonly health: "ready"
  readonly identity: string
  readonly role: ParticipantRole
  readonly runtimeVersion: string
}>

export type ParticipantState = Readonly<{
  readonly identity: string
}>

export type ParticipantStateStore = Readonly<{
  readonly load: () => Promise<unknown>
  readonly save: (state: ParticipantState) => Promise<void>
}>

export type ParticipantIdentitySource = Readonly<{
  readonly create: () => Promise<string>
}>

export type WorkerStartResult =
  | Readonly<{ readonly _tag: "success" }>
  | Readonly<{
      readonly _tag: "failure"
      readonly reason: string
    }>

export type ParticipantWorker = Readonly<{
  readonly start: () => Promise<WorkerStartResult>
  readonly shutdown: () => Promise<void>
}>

export type ParticipantFailure =
  | Readonly<{
      readonly _tag: "invalid-config"
      readonly reason: string
    }>
  | Readonly<{
      readonly _tag: "invalid-persisted-state"
      readonly reason: string
    }>
  | Readonly<{
      readonly _tag: "worker-start-failed"
      readonly reason: string
    }>
  | Readonly<{
      readonly _tag: "participant-stopped"
      readonly reason: string
    }>

export type StartupResult =
  | Readonly<{
      readonly _tag: "success"
      readonly value: ParticipantProjection
    }>
  | Readonly<{
      readonly _tag: "failure"
      readonly error: ParticipantFailure
    }>

export type Participant = Readonly<{
  readonly start: () => Promise<StartupResult>
  readonly shutdown: () => Promise<void>
}>

export type ParticipantDependencies = Readonly<{
  readonly config: unknown
  readonly identitySource: ParticipantIdentitySource
  readonly stateStore: ParticipantStateStore
  readonly worker: ParticipantWorker
}>

type ParticipantConfig = Readonly<{
  readonly displayName: string
  readonly role: ParticipantRole
  readonly runtimeVersion: string
}>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown, maximumLength: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= maximumLength

const parseRole = (value: unknown): ParticipantRole | undefined => {
  if (value === "buyer" || value === "provider" || value === "arbitrator") {
    return value
  }

  return undefined
}

const parseConfig = (value: unknown): ParticipantConfig | ParticipantFailure => {
  if (!isRecord(value)) {
    return { _tag: "invalid-config", reason: "configuration must be an object" }
  }

  const hasOnlyKnownFields = Object.keys(value).every(
    (key) => key === "displayName" || key === "role" || key === "runtimeVersion",
  )

  if (!hasOnlyKnownFields) {
    return { _tag: "invalid-config", reason: "configuration has unknown fields" }
  }

  if (!isNonEmptyString(value.displayName, 80)) {
    return { _tag: "invalid-config", reason: "displayName must be a non-empty string" }
  }

  const role = parseRole(value.role)

  if (role === undefined) {
    return { _tag: "invalid-config", reason: "role must be buyer, provider, or arbitrator" }
  }

  if (!isNonEmptyString(value.runtimeVersion, 32)) {
    return { _tag: "invalid-config", reason: "runtimeVersion must be a non-empty string" }
  }

  return {
    displayName: value.displayName,
    role,
    runtimeVersion: value.runtimeVersion,
  }
}

const parsePersistedState = (value: unknown): ParticipantState | ParticipantFailure | undefined => {
  if (value === undefined) {
    return undefined
  }

  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    !isNonEmptyString(value.identity, 256)
  ) {
    return {
      _tag: "invalid-persisted-state",
      reason: "identity must be a non-empty public identifier",
    }
  }

  return { identity: value.identity }
}

const isFailure = (
  value: ParticipantConfig | ParticipantState | ParticipantFailure,
): value is ParticipantFailure => "_tag" in value

const stoppedResult = (): StartupResult => ({
  _tag: "failure",
  error: {
    _tag: "participant-stopped",
    reason: "participant was shut down before becoming ready",
  },
})

export const createParticipant = (dependencies: ParticipantDependencies): Participant => {
  let workerWasStarted = false
  let shutdownPromise: Promise<void> | undefined
  let startPromise: Promise<StartupResult> | undefined

  const shutdown = (): Promise<void> => {
    if (shutdownPromise !== undefined) {
      return shutdownPromise
    }

    shutdownPromise = workerWasStarted ? dependencies.worker.shutdown() : Promise.resolve()
    return shutdownPromise
  }

  const start = (): Promise<StartupResult> => {
    if (startPromise !== undefined) {
      return startPromise
    }

    if (shutdownPromise !== undefined) {
      return Promise.resolve(stoppedResult())
    }

    startPromise = (async (): Promise<StartupResult> => {
      const config = parseConfig(dependencies.config)

      if (isFailure(config)) {
        return { _tag: "failure", error: config }
      }

      const persistedState = parsePersistedState(await dependencies.stateStore.load())

      if (persistedState !== undefined && isFailure(persistedState)) {
        return { _tag: "failure", error: persistedState }
      }

      if (shutdownPromise !== undefined) {
        return stoppedResult()
      }

      const identity = persistedState?.identity ?? (await dependencies.identitySource.create())

      if (persistedState === undefined) {
        await dependencies.stateStore.save({ identity })
      }

      if (shutdownPromise !== undefined) {
        return stoppedResult()
      }

      workerWasStarted = true
      const workerStart = await dependencies.worker.start()

      if (workerStart._tag === "failure") {
        await shutdown()
        return {
          _tag: "failure",
          error: { _tag: "worker-start-failed", reason: workerStart.reason },
        }
      }

      if (shutdownPromise !== undefined) {
        return stoppedResult()
      }

      return {
        _tag: "success",
        value: {
          displayName: config.displayName,
          health: "ready",
          identity,
          role: config.role,
          runtimeVersion: config.runtimeVersion,
        },
      }
    })()

    return startPromise
  }

  return { start, shutdown }
}

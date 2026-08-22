import * as Brand from 'effect/Brand'
import * as Effect from 'effect/Effect'

export type ParticipantRole = 'buyer' | 'provider' | 'arbitrator'

export type DisplayName = string & Brand.Brand<'DisplayName'>
export const DisplayName = Brand.refined<DisplayName>(
  (value) => value.trim().length > 0 && value.length <= 80,
  () => Brand.error('displayName must be a non-empty string'),
)

export type ParticipantIdentity = string & Brand.Brand<'ParticipantIdentity'>
export const ParticipantIdentity = Brand.refined<ParticipantIdentity>(
  (value) => value.trim().length > 0 && new TextEncoder().encode(value).byteLength <= 256,
  () => Brand.error('identity must be a non-empty public identifier'),
)

export type RuntimeVersion = string & Brand.Brand<'RuntimeVersion'>
export const RuntimeVersion = Brand.refined<RuntimeVersion>(
  (value) => value.trim().length > 0 && value.length <= 32,
  () => Brand.error('runtimeVersion must be a non-empty string'),
)

export type FailureReason = string & Brand.Brand<'FailureReason'>
export const FailureReason = Brand.nominal<FailureReason>()

export type ParticipantProjection = Readonly<{
  readonly displayName: DisplayName
  readonly health: 'ready'
  readonly identity: ParticipantIdentity
  readonly role: ParticipantRole
  readonly runtimeVersion: RuntimeVersion
}>

export type ParticipantState = Readonly<{
  readonly identity: ParticipantIdentity
}>

export type InvalidConfigFailure = Readonly<{
  readonly _tag: 'invalid-config'
  readonly reason: FailureReason
}>

export type InvalidPersistedStateFailure = Readonly<{
  readonly _tag: 'invalid-persisted-state'
  readonly reason: FailureReason
}>

export type StateStoreFailure = Readonly<{
  readonly _tag: 'state-store-failed'
  readonly reason: FailureReason
}>

export type IdentitySourceFailure = Readonly<{
  readonly _tag: 'identity-source-failed'
  readonly reason: FailureReason
}>

export type WorkerStartFailure = Readonly<{
  readonly _tag: 'worker-start-failed'
  readonly reason: FailureReason
}>

export type WorkerShutdownFailure = Readonly<{
  readonly _tag: 'worker-shutdown-failed'
  readonly reason: FailureReason
}>

export type ParticipantStoppedFailure = Readonly<{
  readonly _tag: 'participant-stopped'
  readonly reason: FailureReason
}>

export type ParticipantFailure =
  | InvalidConfigFailure
  | InvalidPersistedStateFailure
  | StateStoreFailure
  | IdentitySourceFailure
  | WorkerStartFailure
  | WorkerShutdownFailure
  | ParticipantStoppedFailure

export type ParticipantStateStore = Readonly<{
  readonly load: Effect.Effect<unknown, StateStoreFailure>
  readonly save: (state: ParticipantState) => Effect.Effect<void, StateStoreFailure>
}>

export type ParticipantIdentitySource = Readonly<{
  readonly create: Effect.Effect<ParticipantIdentity, IdentitySourceFailure>
  readonly verifyPersisted: (
    identity: ParticipantIdentity,
  ) => Effect.Effect<ParticipantIdentity, InvalidPersistedStateFailure>
}>

export type ParticipantWorker = Readonly<{
  readonly start: Effect.Effect<void, WorkerStartFailure>
  readonly shutdown: Effect.Effect<void, WorkerShutdownFailure>
}>

export type Participant = Readonly<{
  readonly start: () => Effect.Effect<ParticipantProjection, ParticipantFailure>
  readonly shutdown: () => Effect.Effect<void, WorkerShutdownFailure>
}>

export type ParticipantDependencies = Readonly<{
  readonly config: unknown
  readonly identitySource: ParticipantIdentitySource
  readonly stateStore: ParticipantStateStore
  readonly worker: ParticipantWorker
}>

type ParticipantConfig = Readonly<{
  readonly displayName: DisplayName
  readonly role: ParticipantRole
  readonly runtimeVersion: RuntimeVersion
}>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseRole = (value: unknown): ParticipantRole | undefined => {
  if (value === 'buyer' || value === 'provider' || value === 'arbitrator') {
    return value
  }

  return undefined
}

const invalidConfig = (reason: string): InvalidConfigFailure => ({
  _tag: 'invalid-config',
  reason: FailureReason(reason),
})

const invalidPersistedState = (reason: string): InvalidPersistedStateFailure => ({
  _tag: 'invalid-persisted-state',
  reason: FailureReason(reason),
})

const stopped = (): ParticipantStoppedFailure => ({
  _tag: 'participant-stopped',
  reason: FailureReason('participant was shut down before becoming ready'),
})

const parseConfig = (value: unknown): Effect.Effect<ParticipantConfig, InvalidConfigFailure> => {
  if (!isRecord(value)) {
    return Effect.fail(invalidConfig('configuration must be an object'))
  }

  const hasOnlyKnownFields = Object.keys(value).every(
    (key) => key === 'displayName' || key === 'role' || key === 'runtimeVersion',
  )

  if (!hasOnlyKnownFields) {
    return Effect.fail(invalidConfig('configuration has unknown fields'))
  }

  if (typeof value['displayName'] !== 'string' || !DisplayName.is(value['displayName'])) {
    return Effect.fail(invalidConfig('displayName must be a non-empty string'))
  }

  const role = parseRole(value['role'])

  if (role === undefined) {
    return Effect.fail(invalidConfig('role must be buyer, provider, or arbitrator'))
  }

  if (typeof value['runtimeVersion'] !== 'string' || !RuntimeVersion.is(value['runtimeVersion'])) {
    return Effect.fail(invalidConfig('runtimeVersion must be a non-empty string'))
  }

  return Effect.succeed({
    displayName: DisplayName(value['displayName']),
    role,
    runtimeVersion: RuntimeVersion(value['runtimeVersion']),
  })
}

const parsePersistedState = (
  value: unknown,
): Effect.Effect<ParticipantState | undefined, InvalidPersistedStateFailure> => {
  if (value === undefined) {
    return Effect.succeed(undefined)
  }

  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    typeof value['identity'] !== 'string' ||
    !ParticipantIdentity.is(value['identity'])
  ) {
    return Effect.fail(invalidPersistedState('identity must be a non-empty public identifier'))
  }

  return Effect.succeed({ identity: ParticipantIdentity(value['identity']) })
}

export const createParticipant = (dependencies: ParticipantDependencies): Participant => {
  let workerWasStarted = false
  let shutdownStarted = false
  let startStarted = false

  const shutdown = (): Effect.Effect<void, WorkerShutdownFailure> =>
    Effect.suspend(() => {
      if (shutdownStarted) {
        return Effect.void
      }

      shutdownStarted = true
      return workerWasStarted ? dependencies.worker.shutdown : Effect.void
    })

  const start = (): Effect.Effect<ParticipantProjection, ParticipantFailure> =>
    Effect.suspend(() => {
      if (startStarted || shutdownStarted) {
        return Effect.fail(stopped())
      }

      startStarted = true

      return Effect.gen(function* () {
        const config = yield* parseConfig(dependencies.config)
        const persistedState = yield* Effect.flatMap(
          dependencies.stateStore.load,
          parsePersistedState,
        )

        if (shutdownStarted) {
          return yield* Effect.fail(stopped())
        }

        const identity =
          persistedState === undefined
            ? yield* dependencies.identitySource.create
            : yield* dependencies.identitySource.verifyPersisted(persistedState.identity)

        if (persistedState === undefined) {
          yield* dependencies.stateStore.save({ identity })
        }

        if (yield* Effect.sync(() => shutdownStarted)) {
          return yield* Effect.fail(stopped())
        }

        workerWasStarted = true
        yield* Effect.catchAll(dependencies.worker.start, (failure) =>
          Effect.zipRight(Effect.either(shutdown()), Effect.fail(failure)),
        )

        if (yield* Effect.sync(() => shutdownStarted)) {
          return yield* Effect.fail(stopped())
        }

        return {
          displayName: config.displayName,
          health: 'ready',
          identity,
          role: config.role,
          runtimeVersion: config.runtimeVersion,
        }
      })
    })

  return { start, shutdown }
}

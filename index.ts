export const packageName = 'agentopoly'

export { createParticipant } from './participant/participant.ts'
export {
  BareWorkerEntrypoint,
  createPearWorker,
  PearDataDirectory,
} from './participant/pear-worker.ts'
export type { PearWorkerOptions } from './participant/pear-worker.ts'
export {
  DisplayName,
  FailureReason,
  ParticipantIdentity,
  RuntimeVersion,
} from './participant/participant.ts'
export type {
  IdentitySourceFailure,
  InvalidConfigFailure,
  InvalidPersistedStateFailure,
  Participant,
  ParticipantDependencies,
  ParticipantFailure,
  ParticipantProjection,
  ParticipantRole,
  ParticipantState,
  ParticipantStateStore,
  ParticipantStoppedFailure,
  ParticipantWorker,
  StateStoreFailure,
  WorkerShutdownFailure,
  WorkerStartFailure,
} from './participant/participant.ts'

export const packageName = "agentopoly"

export { createParticipant } from "./participant/participant.ts"
export { createPearWorker } from "./participant/pear-worker.ts"
export {
  DisplayName,
  FailureReason,
  ParticipantIdentity,
  RuntimeVersion,
} from "./participant/participant.ts"
export type {
  DisplayName,
  FailureReason,
  IdentitySourceFailure,
  InvalidConfigFailure,
  InvalidPersistedStateFailure,
  Participant,
  ParticipantDependencies,
  ParticipantFailure,
  ParticipantIdentity,
  ParticipantProjection,
  ParticipantRole,
  ParticipantState,
  ParticipantStateStore,
  ParticipantStoppedFailure,
  ParticipantWorker,
  RuntimeVersion,
  StateStoreFailure,
  WorkerShutdownFailure,
  WorkerStartFailure,
} from "./participant/participant.ts"

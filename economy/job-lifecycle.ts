import * as Brand from 'effect/Brand'
import * as Effect from 'effect/Effect'

export type JobId = string & Brand.Brand<'JobId'>
export const JobId = Brand.refined<JobId>(
  (value) => value.trim().length > 0 && value.length <= 256,
  () => Brand.error('jobId must be a non-empty bounded identifier'),
)

export type EvidenceHash = string & Brand.Brand<'EvidenceHash'>
export const EvidenceHash = Brand.refined<EvidenceHash>(
  (value) => /^[a-f0-9]{64}$/.test(value),
  () => Brand.error('evidence hash must be 32 lowercase hexadecimal bytes'),
)

export type ParticipantId = string & Brand.Brand<'EconomyParticipantId'>
export const ParticipantId = Brand.refined<ParticipantId>(
  (value) => value.trim().length > 0 && value.length <= 256,
  () => Brand.error('participant identity must be non-empty and bounded'),
)

export type NetworkId = string & Brand.Brand<'NetworkId'>
export const NetworkId = Brand.refined<NetworkId>(
  (value) => value.trim().length > 0 && value.length <= 128,
  () => Brand.error('network must be non-empty and bounded'),
)

export type WalletDestination = string & Brand.Brand<'WalletDestination'>
export const WalletDestination = Brand.refined<WalletDestination>(
  (value) => value.trim().length > 0 && value.length <= 256,
  () => Brand.error('wallet destination must be non-empty and bounded'),
)

export type AtomicAmount = bigint & Brand.Brand<'AtomicAmount'>
export const AtomicAmount = Brand.refined<AtomicAmount>(
  (value) => value > 0n,
  () => Brand.error('atomic amount must be greater than zero'),
)

export type PaymentStatus = 'not-authorized' | 'pending-receipt' | 'paid' | 'withheld'

export type JobStage =
  | Readonly<{ readonly _tag: 'agreed' }>
  | Readonly<{ readonly _tag: 'delivered'; readonly artifactHash: EvidenceHash }>
  | Readonly<{
      readonly _tag: 'verification-passed'
      readonly artifactHash: EvidenceHash
      readonly verificationHash: EvidenceHash
    }>
  | Readonly<{
      readonly _tag: 'paid'
      readonly artifactHash: EvidenceHash
      readonly transactionHash: EvidenceHash
      readonly verificationHash: EvidenceHash
    }>
  | Readonly<{
      readonly _tag: 'verification-failed'
      readonly artifactHash: EvidenceHash
      readonly verificationHash: EvidenceHash
    }>
  | Readonly<{
      readonly _tag: 'disputed'
      readonly artifactHash: EvidenceHash
      readonly disputeHash: EvidenceHash
      readonly verificationHash: EvidenceHash
    }>
  | Readonly<{
      readonly _tag: 'arbitrating'
      readonly arbitrator: ParticipantId
      readonly arbitrationTransactionHash: EvidenceHash
      readonly artifactHash: EvidenceHash
      readonly disputeHash: EvidenceHash
      readonly verificationHash: EvidenceHash
    }>
  | Readonly<{
      readonly _tag: 'ruled'
      readonly arbitrator: ParticipantId
      readonly arbitrationTransactionHash: EvidenceHash
      readonly artifactHash: EvidenceHash
      readonly disputeHash: EvidenceHash
      readonly rulingHash: EvidenceHash
      readonly verificationHash: EvidenceHash
      readonly winner: 'buyer' | 'provider'
    }>

export type AgreedJob = Readonly<{
  readonly admittedEvents: Readonly<Record<string, EvidenceHash>>
  readonly agreementHash: EvidenceHash
  readonly asset: 'USDt'
  readonly buyer: ParticipantId
  readonly destination: WalletDestination
  readonly jobId: JobId
  readonly network: NetworkId
  readonly price: AtomicAmount
  readonly provider: ParticipantId
  readonly stage: JobStage
}>

export type JobLifecycleFailure = Readonly<{
  readonly _tag:
    | 'conflicting-event'
    | 'evidence-mismatch'
    | 'invalid-event'
    | 'invalid-terms'
    | 'invalid-transition'
  readonly reason: string
}>

export type ProviderReputation = Readonly<{
  readonly disputesLost: number
  readonly failedDeliveries: number
  readonly paidJobs: number
  readonly provider: ParticipantId
}>

export type JobProjection = Readonly<{
  readonly evidenceSource: 'recorded-fixture'
  readonly jobId: JobId
  readonly paymentStatus: PaymentStatus
  readonly provider: ParticipantId
  readonly stage: JobStage['_tag']
}>

type ParsedEventBase = Readonly<{
  readonly eventHash: EvidenceHash
  readonly eventId: string
  readonly kind: string
  readonly value: Record<string, unknown>
}>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const failure = (tag: JobLifecycleFailure['_tag'], reason: string): JobLifecycleFailure => ({
  _tag: tag,
  reason,
})

const isBoundedString = (value: unknown, maximumLength = 256): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= maximumLength

const parseAtomicAmount = (value: unknown): AtomicAmount | undefined => {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) || value.length > 78) {
    return undefined
  }

  const amount = BigInt(value)
  return AtomicAmount.is(amount) ? AtomicAmount(amount) : undefined
}

const parseHash = (value: unknown): EvidenceHash | undefined =>
  typeof value === 'string' && EvidenceHash.is(value) ? EvidenceHash(value) : undefined

const parseParticipant = (value: unknown): ParticipantId | undefined =>
  typeof value === 'string' && ParticipantId.is(value) ? ParticipantId(value) : undefined

const hasOnlyFields = (value: Record<string, unknown>, fields: readonly string[]): boolean => {
  const allowed = new Set(fields)
  return Object.keys(value).every((key) => allowed.has(key))
}

const parseEventBase = (value: unknown): Effect.Effect<ParsedEventBase, JobLifecycleFailure> => {
  if (!isRecord(value)) {
    return Effect.fail(failure('invalid-event', 'event must be an object'))
  }

  const eventHash = parseHash(value['eventHash'])
  if (
    !isBoundedString(value['eventId']) ||
    eventHash === undefined ||
    !isBoundedString(value['kind'])
  ) {
    return Effect.fail(failure('invalid-event', 'event identity, hash, and kind are required'))
  }

  return Effect.succeed({ eventHash, eventId: value['eventId'], kind: value['kind'], value })
}

const withEvent = (job: AgreedJob, event: ParsedEventBase, stage: JobStage): AgreedJob => ({
  ...job,
  admittedEvents: { ...job.admittedEvents, [event.eventId]: event.eventHash },
  stage,
})

const requireJobId = (job: AgreedJob, value: unknown): JobLifecycleFailure | undefined =>
  value === job.jobId ? undefined : failure('evidence-mismatch', 'event references another job')

const recordDelivery = (
  job: AgreedJob,
  event: ParsedEventBase,
): Effect.Effect<AgreedJob, JobLifecycleFailure> => {
  if (job.stage._tag !== 'agreed') {
    return Effect.fail(failure('invalid-transition', 'delivery requires an agreed job'))
  }

  if (!hasOnlyFields(event.value, ['artifactHash', 'eventHash', 'eventId', 'jobId', 'kind'])) {
    return Effect.fail(failure('invalid-event', 'delivery has unknown fields'))
  }

  const jobFailure = requireJobId(job, event.value['jobId'])
  const artifactHash = parseHash(event.value['artifactHash'])
  if (jobFailure !== undefined) return Effect.fail(jobFailure)
  if (artifactHash === undefined) {
    return Effect.fail(failure('invalid-event', 'delivery requires an artifact hash'))
  }

  return Effect.succeed(withEvent(job, event, { _tag: 'delivered', artifactHash }))
}

const recordVerification = (
  job: AgreedJob,
  event: ParsedEventBase,
): Effect.Effect<AgreedJob, JobLifecycleFailure> => {
  if (job.stage._tag !== 'delivered') {
    return Effect.fail(failure('invalid-transition', 'verification requires a delivery'))
  }

  if (
    !hasOnlyFields(event.value, [
      'artifactHash',
      'eventHash',
      'eventId',
      'jobId',
      'kind',
      'passed',
      'verificationHash',
    ])
  ) {
    return Effect.fail(failure('invalid-event', 'verification has unknown fields'))
  }

  const jobFailure = requireJobId(job, event.value['jobId'])
  const artifactHash = parseHash(event.value['artifactHash'])
  const verificationHash = parseHash(event.value['verificationHash'])
  if (jobFailure !== undefined) return Effect.fail(jobFailure)
  if (artifactHash !== job.stage.artifactHash) {
    return Effect.fail(failure('evidence-mismatch', 'verification references another artifact'))
  }
  if (verificationHash === undefined || typeof event.value['passed'] !== 'boolean') {
    return Effect.fail(failure('invalid-event', 'verification result is incomplete'))
  }

  return Effect.succeed(
    withEvent(job, event, {
      _tag: event.value['passed'] ? 'verification-passed' : 'verification-failed',
      artifactHash,
      verificationHash,
    }),
  )
}

const recordProviderPayment = (
  job: AgreedJob,
  event: ParsedEventBase,
): Effect.Effect<AgreedJob, JobLifecycleFailure> => {
  if (job.stage._tag !== 'verification-passed') {
    return Effect.fail(
      failure('invalid-transition', 'provider payment requires passed verification'),
    )
  }

  if (
    !hasOnlyFields(event.value, [
      'agreementHash',
      'asset',
      'atomicAmount',
      'beneficiary',
      'destination',
      'eventHash',
      'eventId',
      'jobId',
      'kind',
      'network',
      'purpose',
      'transactionHash',
      'verificationHash',
    ])
  ) {
    return Effect.fail(failure('invalid-event', 'payment receipt has unknown fields'))
  }

  const amount = parseAtomicAmount(event.value['atomicAmount'])
  const transactionHash = parseHash(event.value['transactionHash'])
  const valuesMatch =
    event.value['jobId'] === job.jobId &&
    event.value['agreementHash'] === job.agreementHash &&
    event.value['asset'] === job.asset &&
    amount === job.price &&
    event.value['beneficiary'] === job.provider &&
    event.value['destination'] === job.destination &&
    event.value['network'] === job.network &&
    event.value['purpose'] === 'provider' &&
    event.value['verificationHash'] === job.stage.verificationHash

  if (!valuesMatch) {
    return Effect.fail(failure('evidence-mismatch', 'payment receipt does not match the job'))
  }
  if (transactionHash === undefined) {
    return Effect.fail(failure('invalid-event', 'payment receipt requires a transaction hash'))
  }

  return Effect.succeed(
    withEvent(job, event, {
      _tag: 'paid',
      artifactHash: job.stage.artifactHash,
      transactionHash,
      verificationHash: job.stage.verificationHash,
    }),
  )
}

const openDispute = (
  job: AgreedJob,
  event: ParsedEventBase,
): Effect.Effect<AgreedJob, JobLifecycleFailure> => {
  if (job.stage._tag !== 'verification-failed') {
    return Effect.fail(failure('invalid-transition', 'dispute requires failed verification'))
  }

  if (
    !hasOnlyFields(event.value, [
      'disputeHash',
      'eventHash',
      'eventId',
      'jobId',
      'kind',
      'verificationHash',
    ])
  ) {
    return Effect.fail(failure('invalid-event', 'dispute has unknown fields'))
  }

  const disputeHash = parseHash(event.value['disputeHash'])
  if (
    event.value['jobId'] !== job.jobId ||
    event.value['verificationHash'] !== job.stage.verificationHash
  ) {
    return Effect.fail(failure('evidence-mismatch', 'dispute does not match verification'))
  }
  if (disputeHash === undefined) {
    return Effect.fail(failure('invalid-event', 'dispute requires an evidence hash'))
  }

  return Effect.succeed(
    withEvent(job, event, {
      _tag: 'disputed',
      artifactHash: job.stage.artifactHash,
      disputeHash,
      verificationHash: job.stage.verificationHash,
    }),
  )
}

const hireArbitrator = (
  job: AgreedJob,
  event: ParsedEventBase,
): Effect.Effect<AgreedJob, JobLifecycleFailure> => {
  if (job.stage._tag !== 'disputed') {
    return Effect.fail(failure('invalid-transition', 'arbitration requires an open dispute'))
  }

  if (
    !hasOnlyFields(event.value, [
      'arbitrationJobId',
      'arbitrator',
      'asset',
      'atomicAmount',
      'beneficiary',
      'disputeHash',
      'eventHash',
      'eventId',
      'jobId',
      'kind',
      'network',
      'purpose',
      'transactionHash',
    ])
  ) {
    return Effect.fail(failure('invalid-event', 'arbitration receipt has unknown fields'))
  }

  const arbitrator = parseParticipant(event.value['arbitrator'])
  const amount = parseAtomicAmount(event.value['atomicAmount'])
  const transactionHash = parseHash(event.value['transactionHash'])
  if (
    arbitrator === undefined ||
    amount === undefined ||
    transactionHash === undefined ||
    !isBoundedString(event.value['arbitrationJobId'])
  ) {
    return Effect.fail(failure('invalid-event', 'arbitration receipt is incomplete'))
  }

  const valuesMatch =
    event.value['jobId'] === job.jobId &&
    event.value['disputeHash'] === job.stage.disputeHash &&
    event.value['asset'] === 'USDt' &&
    event.value['network'] === job.network &&
    event.value['purpose'] === 'arbitration' &&
    event.value['beneficiary'] === arbitrator

  if (!valuesMatch) {
    return Effect.fail(
      failure('evidence-mismatch', 'arbitration receipt does not match the dispute'),
    )
  }

  return Effect.succeed(
    withEvent(job, event, {
      _tag: 'arbitrating',
      arbitrator,
      arbitrationTransactionHash: transactionHash,
      artifactHash: job.stage.artifactHash,
      disputeHash: job.stage.disputeHash,
      verificationHash: job.stage.verificationHash,
    }),
  )
}

const recordRuling = (
  job: AgreedJob,
  event: ParsedEventBase,
): Effect.Effect<AgreedJob, JobLifecycleFailure> => {
  if (job.stage._tag !== 'arbitrating') {
    return Effect.fail(failure('invalid-transition', 'ruling requires paid arbitration'))
  }

  if (
    !hasOnlyFields(event.value, [
      'arbitrator',
      'disputeHash',
      'eventHash',
      'eventId',
      'jobId',
      'kind',
      'rulingHash',
      'winner',
    ])
  ) {
    return Effect.fail(failure('invalid-event', 'ruling has unknown fields'))
  }

  const rulingHash = parseHash(event.value['rulingHash'])
  const winner = event.value['winner']
  if (
    event.value['jobId'] !== job.jobId ||
    event.value['disputeHash'] !== job.stage.disputeHash ||
    event.value['arbitrator'] !== job.stage.arbitrator
  ) {
    return Effect.fail(failure('evidence-mismatch', 'ruling does not match the arbitration'))
  }
  if (rulingHash === undefined || (winner !== 'buyer' && winner !== 'provider')) {
    return Effect.fail(failure('invalid-event', 'ruling is incomplete'))
  }

  return Effect.succeed(
    withEvent(job, event, {
      ...job.stage,
      _tag: 'ruled',
      rulingHash,
      winner,
    }),
  )
}

export const createAgreedJob = (input: unknown): Effect.Effect<AgreedJob, JobLifecycleFailure> => {
  if (
    !isRecord(input) ||
    !hasOnlyFields(input, [
      'agreementHash',
      'asset',
      'atomicAmount',
      'buyer',
      'destination',
      'jobId',
      'network',
      'provider',
    ])
  ) {
    return Effect.fail(failure('invalid-terms', 'agreed terms have an invalid shape'))
  }

  const agreementHash = parseHash(input['agreementHash'])
  const buyer = parseParticipant(input['buyer'])
  const destination = input['destination']
  const jobId = input['jobId']
  const network = input['network']
  const price = parseAtomicAmount(input['atomicAmount'])
  const provider = parseParticipant(input['provider'])

  if (
    agreementHash === undefined ||
    input['asset'] !== 'USDt' ||
    buyer === undefined ||
    typeof destination !== 'string' ||
    !WalletDestination.is(destination) ||
    typeof jobId !== 'string' ||
    !JobId.is(jobId) ||
    typeof network !== 'string' ||
    !NetworkId.is(network) ||
    price === undefined ||
    provider === undefined ||
    buyer === provider
  ) {
    return Effect.fail(failure('invalid-terms', 'agreed terms violate a domain invariant'))
  }

  return Effect.succeed({
    admittedEvents: {},
    agreementHash,
    asset: 'USDt',
    buyer,
    destination: WalletDestination(destination),
    jobId: JobId(jobId),
    network: NetworkId(network),
    price,
    provider,
    stage: { _tag: 'agreed' },
  })
}

export const applyJobEvent = (
  job: AgreedJob,
  input: unknown,
): Effect.Effect<AgreedJob, JobLifecycleFailure> =>
  Effect.flatMap(parseEventBase(input), (event) => {
    const recordedHash = job.admittedEvents[event.eventId]
    if (recordedHash !== undefined) {
      return recordedHash === event.eventHash
        ? Effect.succeed(job)
        : Effect.fail(failure('conflicting-event', 'event id was reused with different evidence'))
    }

    switch (event.kind) {
      case 'delivery-recorded':
        return recordDelivery(job, event)
      case 'verification-recorded':
        return recordVerification(job, event)
      case 'payment-receipt-recorded':
        return recordProviderPayment(job, event)
      case 'dispute-opened':
        return openDispute(job, event)
      case 'arbitration-hired':
        return hireArbitrator(job, event)
      case 'ruling-recorded':
        return recordRuling(job, event)
      default:
        return Effect.fail(failure('invalid-event', 'event kind is not supported'))
    }
  })

export const projectProviderReputation = (
  jobs: readonly AgreedJob[],
  provider: ParticipantId,
): ProviderReputation =>
  jobs
    .filter((job) => job.provider === provider)
    .reduce<ProviderReputation>(
      (reputation, job) => {
        const failed =
          job.stage._tag === 'verification-failed' ||
          job.stage._tag === 'disputed' ||
          job.stage._tag === 'arbitrating' ||
          job.stage._tag === 'ruled'
        const lost = job.stage._tag === 'ruled' && job.stage.winner === 'buyer'

        return {
          disputesLost: reputation.disputesLost + (lost ? 1 : 0),
          failedDeliveries: reputation.failedDeliveries + (failed ? 1 : 0),
          paidJobs: reputation.paidJobs + (job.stage._tag === 'paid' ? 1 : 0),
          provider,
        }
      },
      { disputesLost: 0, failedDeliveries: 0, paidJobs: 0, provider },
    )

const paymentStatus = (stage: JobStage): PaymentStatus => {
  switch (stage._tag) {
    case 'agreed':
    case 'delivered':
      return 'not-authorized'
    case 'verification-passed':
      return 'pending-receipt'
    case 'paid':
      return 'paid'
    case 'verification-failed':
    case 'disputed':
    case 'arbitrating':
    case 'ruled':
      return 'withheld'
  }
}

export const toJobProjection = (job: AgreedJob): JobProjection => ({
  evidenceSource: 'recorded-fixture',
  jobId: job.jobId,
  paymentStatus: paymentStatus(job.stage),
  provider: job.provider,
  stage: job.stage._tag,
})

import * as Brand from 'effect/Brand'
import * as Effect from 'effect/Effect'

export type DashboardAgentId = string & Brand.Brand<'DashboardAgentId'>
export const DashboardAgentId = Brand.refined<DashboardAgentId>(
  (value) => value.trim().length > 0 && new TextEncoder().encode(value).byteLength <= 256,
  () => Brand.error('dashboard agent identifier must be bounded'),
)

export type DashboardJobId = string & Brand.Brand<'DashboardJobId'>
export const DashboardJobId = Brand.refined<DashboardJobId>(
  (value) => value.trim().length > 0 && new TextEncoder().encode(value).byteLength <= 256,
  () => Brand.error('dashboard job identifier must be bounded'),
)

export type DashboardReference = string & Brand.Brand<'DashboardReference'>
export const DashboardReference = Brand.refined<DashboardReference>(
  (value) => value.trim().length > 0 && new TextEncoder().encode(value).byteLength <= 1024,
  () => Brand.error('dashboard reference must be bounded'),
)

export type ProjectionRevision = string & Brand.Brand<'ProjectionRevision'>
export const ProjectionRevision = Brand.refined<ProjectionRevision>(
  (value) => /^[1-9][0-9]*$/u.test(value),
  () => Brand.error('projection revision must be a positive integer'),
)

export type DashboardRole = 'arbitrator' | 'buyer' | 'provider'
export type DashboardAvailability = 'available' | 'offline' | 'unknown'
export type DashboardFreshness = 'fresh' | 'stale'
export type DashboardJobPhase = 'disputed' | 'reconciliation' | 'ruled' | 'verified'
export type DashboardPaymentState = 'receipted' | 'undetermined' | 'withheld'
export type DashboardSettlementState =
  'broadcast' | 'not-broadcast' | 'observed' | 'reconciliation-pending' | 'settled'
export type DashboardVerificationState = 'failed' | 'not-run' | 'passed'

export type DashboardAgent = Readonly<{
  readonly availability: DashboardAvailability
  readonly id: DashboardAgentId
  readonly label: string
  readonly role: DashboardRole
  readonly selectionEvidence: string
}>

type DashboardJobEvidence = Readonly<{
  readonly artifactReference: DashboardReference
  readonly evidenceReference: DashboardReference
  readonly id: DashboardJobId
  readonly providerId: DashboardAgentId
  readonly termsReference: DashboardReference
  readonly title: string
}>

type DashboardCompletedJob = DashboardJobEvidence &
  Readonly<{
    readonly payment: 'receipted'
    readonly phase: 'ruled' | 'verified'
    readonly settlement: 'broadcast' | 'observed' | 'settled'
    readonly verification: 'passed'
  }>

type DashboardDisputedJob = DashboardJobEvidence &
  Readonly<{
    readonly payment: 'withheld'
    readonly phase: 'disputed'
    readonly settlement: 'not-broadcast'
    readonly verification: 'failed'
  }>

type DashboardReconciliationJob = DashboardJobEvidence &
  Readonly<{
    readonly payment: 'undetermined'
    readonly phase: 'reconciliation'
    readonly settlement: 'reconciliation-pending'
    readonly verification: 'not-run'
  }>

export type DashboardJob = DashboardCompletedJob | DashboardDisputedJob | DashboardReconciliationJob

export type DashboardProjection = Readonly<{
  readonly agents: readonly DashboardAgent[]
  readonly freshness: DashboardFreshness
  readonly generatedAt: string
  readonly jobs: readonly DashboardJob[]
  readonly revision: ProjectionRevision
}>

export type InvalidDashboardProjection = Readonly<{
  readonly _tag: 'invalid-dashboard-projection'
  readonly reason: string
}>

export type OutOfOrderDashboardProjection = Readonly<{
  readonly _tag: 'out-of-order-dashboard-projection'
  readonly reason: string
}>

export type ConflictingDashboardProjection = Readonly<{
  readonly _tag: 'conflicting-dashboard-projection'
  readonly reason: string
}>

export type DashboardProjectionStore = Readonly<{
  readonly current: () => DashboardProjection
  readonly publish: (
    projection: DashboardProjection,
  ) => Effect.Effect<void, OutOfOrderDashboardProjection | ConflictingDashboardProjection>
}>

const invalidProjection = (reason: string): InvalidDashboardProjection => ({
  _tag: 'invalid-dashboard-projection',
  reason,
})

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasOnlyKeys = (
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
): boolean => Object.keys(value).every((key) => allowed.includes(key))

const isBoundedText = (value: unknown): value is string =>
  typeof value === 'string' && new TextEncoder().encode(value).byteLength <= 1024

const allDefined = <Value>(values: readonly (Value | undefined)[]): values is readonly Value[] =>
  values.every((value) => value !== undefined)

const parseRole = (value: unknown): DashboardRole | undefined =>
  value === 'arbitrator' || value === 'buyer' || value === 'provider' ? value : undefined

const parseAvailability = (value: unknown): DashboardAvailability | undefined =>
  value === 'available' || value === 'offline' || value === 'unknown' ? value : undefined

const parseFreshness = (value: unknown): DashboardFreshness | undefined =>
  value === 'fresh' || value === 'stale' ? value : undefined

const parseJobPhase = (value: unknown): DashboardJobPhase | undefined =>
  value === 'disputed' || value === 'reconciliation' || value === 'ruled' || value === 'verified'
    ? value
    : undefined

const parsePaymentState = (value: unknown): DashboardPaymentState | undefined =>
  value === 'receipted' || value === 'undetermined' || value === 'withheld' ? value : undefined

const parseSettlementState = (value: unknown): DashboardSettlementState | undefined =>
  value === 'broadcast' ||
  value === 'not-broadcast' ||
  value === 'observed' ||
  value === 'reconciliation-pending' ||
  value === 'settled'
    ? value
    : undefined

const parseVerificationState = (value: unknown): DashboardVerificationState | undefined =>
  value === 'failed' || value === 'not-run' || value === 'passed' ? value : undefined

const parseAgent = (value: unknown): DashboardAgent | undefined => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['availability', 'id', 'label', 'role', 'selectionEvidence']) ||
    typeof value['id'] !== 'string' ||
    !DashboardAgentId.is(value['id']) ||
    !isBoundedText(value['label']) ||
    !isBoundedText(value['selectionEvidence'])
  ) {
    return undefined
  }

  const role = parseRole(value['role'])
  const availability = parseAvailability(value['availability'])

  if (role === undefined || availability === undefined) {
    return undefined
  }

  return {
    availability,
    id: DashboardAgentId(value['id']),
    label: value['label'],
    role,
    selectionEvidence: value['selectionEvidence'],
  }
}

const parseJob = (value: unknown): DashboardJob | undefined => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'artifactReference',
      'evidenceReference',
      'id',
      'payment',
      'phase',
      'providerId',
      'settlement',
      'termsReference',
      'title',
      'verification',
    ]) ||
    typeof value['artifactReference'] !== 'string' ||
    !DashboardReference.is(value['artifactReference']) ||
    typeof value['evidenceReference'] !== 'string' ||
    !DashboardReference.is(value['evidenceReference']) ||
    typeof value['id'] !== 'string' ||
    !DashboardJobId.is(value['id']) ||
    typeof value['providerId'] !== 'string' ||
    !DashboardAgentId.is(value['providerId']) ||
    typeof value['termsReference'] !== 'string' ||
    !DashboardReference.is(value['termsReference']) ||
    !isBoundedText(value['title'])
  ) {
    return undefined
  }

  const payment = parsePaymentState(value['payment'])
  const phase = parseJobPhase(value['phase'])
  const settlement = parseSettlementState(value['settlement'])
  const verification = parseVerificationState(value['verification'])

  if (
    payment === undefined ||
    phase === undefined ||
    settlement === undefined ||
    verification === undefined
  ) {
    return undefined
  }

  const evidence: DashboardJobEvidence = {
    artifactReference: DashboardReference(value['artifactReference']),
    evidenceReference: DashboardReference(value['evidenceReference']),
    id: DashboardJobId(value['id']),
    providerId: DashboardAgentId(value['providerId']),
    termsReference: DashboardReference(value['termsReference']),
    title: value['title'],
  }

  if (
    phase === 'disputed' &&
    payment === 'withheld' &&
    settlement === 'not-broadcast' &&
    verification === 'failed'
  ) {
    return { ...evidence, payment, phase, settlement, verification }
  }

  if (
    phase === 'reconciliation' &&
    payment === 'undetermined' &&
    settlement === 'reconciliation-pending' &&
    verification === 'not-run'
  ) {
    return { ...evidence, payment, phase, settlement, verification }
  }

  if (
    (phase === 'ruled' || phase === 'verified') &&
    payment === 'receipted' &&
    (settlement === 'broadcast' || settlement === 'observed' || settlement === 'settled') &&
    verification === 'passed'
  ) {
    return { ...evidence, payment, phase, settlement, verification }
  }

  return undefined
}

const decodeProjection = (value: unknown): DashboardProjection | undefined => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['agents', 'freshness', 'generatedAt', 'jobs', 'revision']) ||
    !Array.isArray(value['agents']) ||
    value['agents'].length > 64 ||
    !isBoundedText(value['generatedAt']) ||
    Number.isNaN(Date.parse(value['generatedAt'])) ||
    !Array.isArray(value['jobs']) ||
    value['jobs'].length > 128 ||
    typeof value['revision'] !== 'string' ||
    !ProjectionRevision.is(value['revision'])
  ) {
    return undefined
  }

  const freshness = parseFreshness(value['freshness'])
  const agents = value['agents'].map(parseAgent)
  const jobs = value['jobs'].map(parseJob)

  if (freshness === undefined || !allDefined(agents) || !allDefined(jobs)) {
    return undefined
  }

  const definedAgents = agents.filter((agent): agent is DashboardAgent => agent !== undefined)
  const definedJobs = jobs.filter((job): job is DashboardJob => job !== undefined)
  const agentIds = new Set(definedAgents.map((agent) => agent.id))
  const jobIds = new Set(definedJobs.map((job) => job.id))

  if (
    agentIds.size !== definedAgents.length ||
    jobIds.size !== definedJobs.length ||
    definedJobs.some((job) => !agentIds.has(job.providerId))
  ) {
    return undefined
  }

  return {
    agents: definedAgents,
    freshness,
    generatedAt: value['generatedAt'],
    jobs: definedJobs,
    revision: ProjectionRevision(value['revision']),
  }
}

export const decodeDashboardProjection = (
  value: unknown,
): Effect.Effect<DashboardProjection, InvalidDashboardProjection> =>
  Effect.try({
    try: () => decodeProjection(value),
    catch: () => invalidProjection('projection cannot be decoded safely'),
  }).pipe(
    Effect.flatMap((projection) =>
      projection === undefined
        ? Effect.fail(invalidProjection('projection does not match the bounded dashboard contract'))
        : Effect.succeed(projection),
    ),
  )

const projectionEquals = (left: DashboardProjection, right: DashboardProjection): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

export const createDashboardProjectionStore = (
  initial: DashboardProjection,
): DashboardProjectionStore => {
  let currentProjection = initial

  const publish = (
    projection: DashboardProjection,
  ): Effect.Effect<void, OutOfOrderDashboardProjection | ConflictingDashboardProjection> =>
    Effect.suspend(() => {
      const incomingRevision = BigInt(projection.revision)
      const currentRevision = BigInt(currentProjection.revision)

      if (incomingRevision < currentRevision) {
        return Effect.fail<OutOfOrderDashboardProjection | ConflictingDashboardProjection>({
          _tag: 'out-of-order-dashboard-projection',
          reason: 'incoming projection revision is older than the current projection',
        })
      }

      if (incomingRevision === currentRevision) {
        return projectionEquals(projection, currentProjection)
          ? Effect.void
          : Effect.fail<OutOfOrderDashboardProjection | ConflictingDashboardProjection>({
              _tag: 'conflicting-dashboard-projection',
              reason: 'incoming projection revision conflicts with the current projection',
            })
      }

      currentProjection = projection
      return Effect.void
    })

  return { current: () => currentProjection, publish }
}

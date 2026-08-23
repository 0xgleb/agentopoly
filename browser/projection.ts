import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'

const MAX_EVENT_LOG_BYTES = 1_048_576
const MAX_EVENT_LINES = 4_096
const MAX_EVENT_LINE_BYTES = 65_536
const MAX_FUTURE_SKEW_MILLISECONDS = 30_000
const STALE_AFTER_MILLISECONDS = 5 * 60 * 1_000

type EventBase = Readonly<{
  readonly freshness: 'current' | 'stale'
  readonly jobId: string
  readonly recordedAt: string
  readonly workspace: string
}>

type RecordedEvent =
  | (EventBase &
      Readonly<{
        readonly profile: string
        readonly type: 'provider.started'
      }>)
  | (EventBase &
      Readonly<{
        readonly artifactHash: string
        readonly profile: string
        readonly type: 'provider.artifact-submitted'
      }>)
  | (EventBase &
      Readonly<{
        readonly artifactHash: string
        readonly passed: boolean
        readonly type: 'verification.completed'
      }>)
  | (EventBase &
      Readonly<{
        readonly artifactHash: string
        readonly reason: 'missing-exact-payment-authorization' | 'verification-failed'
        readonly type: 'payment.refused'
        readonly wdkInvoked: false
      }>)
  | (EventBase &
      Readonly<{
        readonly artifactHash: string
        readonly paymentStatus: 'refused'
        readonly type: 'settlement.refusal-recorded'
        readonly verificationStatus: 'failed' | 'passed'
      }>)
  | (EventBase &
      Readonly<{
        readonly delta: -1 | 1
        readonly reason: 'failed-verification' | 'verified-delivery'
        readonly type: 'reputation.updated'
      }>)

export type BrowserAgentProjection = Readonly<{
  readonly profile: string
  readonly role: 'provider'
  readonly source: 'live-agent-run'
}>

export type BrowserJobProjection = Readonly<{
  readonly artifactHash?: string
  readonly jobId: string
  readonly payment:
    | Readonly<{ readonly _tag: 'not-recorded' }>
    | Readonly<{
        readonly _tag: 'refused'
        readonly reason: 'missing-exact-payment-authorization' | 'verification-failed'
        readonly wdkInvoked: false
      }>
  readonly providerProfile?: string
  readonly verification: 'failed' | 'passed' | 'unobserved'
  readonly workspace: string
}>

export type BrowserEventProjection = Readonly<{
  readonly freshness: 'current' | 'stale'
  readonly jobId: string
  readonly recordedAt: string
  readonly type: RecordedEvent['type']
}>

export type BrowserProjection = Readonly<{
  readonly _tag: 'projection'
  readonly agents: readonly BrowserAgentProjection[]
  readonly events: readonly BrowserEventProjection[]
  readonly jobs: readonly BrowserJobProjection[]
  readonly unobserved: readonly ['capability discovery', 'signed terms']
}>

export type BrowserProjectionRefusal = Readonly<{
  readonly _tag: 'refused'
  readonly reason:
    'event-log-too-large' | 'future-event' | 'malformed-event-log' | 'too-many-events'
}>

export type BrowserProjectionResult = BrowserProjection | BrowserProjectionRefusal

type ParsedEvent = Readonly<{
  readonly event: RecordedEvent
  readonly index: number
}>

type MutableJobProjection = {
  artifactHash?: string
  jobId: string
  payment: BrowserJobProjection['payment']
  providerProfile?: string
  verification: BrowserJobProjection['verification']
  workspace: string
}

const refusal = (reason: BrowserProjectionRefusal['reason']): BrowserProjectionRefusal => ({
  _tag: 'refused',
  reason,
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const utf8Length = (value: string): number => new TextEncoder().encode(value).byteLength

const isBoundedString = (value: unknown, maximumLength: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && utf8Length(value) <= maximumLength

const isHash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

const isProfile = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,31}$/.test(value)

const hasOnlyFields = (value: Record<string, unknown>, fields: readonly string[]): boolean => {
  const allowed = new Set(fields)
  return Object.keys(value).every((key) => allowed.has(key))
}

const decodeLine = (line: string): Effect.Effect<unknown, BrowserProjectionRefusal> =>
  Effect.try({
    try: (): unknown => JSON.parse(line),
    catch: () => refusal('malformed-event-log'),
  })

const parseEvent = (
  value: unknown,
  observedAt: Date,
  index: number,
): ParsedEvent | BrowserProjectionRefusal => {
  if (
    !isRecord(value) ||
    value['schemaVersion'] !== 1 ||
    value['evidenceSource'] !== 'live-agent-run' ||
    !isBoundedString(value['jobId'], 128) ||
    !isBoundedString(value['workspace'], 1_024) ||
    typeof value['recordedAt'] !== 'string'
  ) {
    return refusal('malformed-event-log')
  }

  const timestamp = Date.parse(value['recordedAt'])
  if (!Number.isFinite(timestamp)) return refusal('malformed-event-log')
  if (timestamp - observedAt.getTime() > MAX_FUTURE_SKEW_MILLISECONDS)
    return refusal('future-event')

  const commonFields = [
    'evidenceSource',
    'jobId',
    'recordedAt',
    'schemaVersion',
    'type',
    'workspace',
  ]
  const base: EventBase = {
    freshness: observedAt.getTime() - timestamp > STALE_AFTER_MILLISECONDS ? 'stale' : 'current',
    jobId: value['jobId'],
    recordedAt: value['recordedAt'],
    workspace: value['workspace'],
  }

  switch (value['type']) {
    case 'provider.started':
      if (!hasOnlyFields(value, [...commonFields, 'profile']) || !isProfile(value['profile'])) {
        return refusal('malformed-event-log')
      }
      return { event: { ...base, profile: value['profile'], type: 'provider.started' }, index }
    case 'provider.artifact-submitted':
      if (
        !hasOnlyFields(value, [...commonFields, 'artifactHash', 'profile']) ||
        !isHash(value['artifactHash']) ||
        !isProfile(value['profile'])
      ) {
        return refusal('malformed-event-log')
      }
      return {
        event: {
          ...base,
          artifactHash: value['artifactHash'],
          profile: value['profile'],
          type: 'provider.artifact-submitted',
        },
        index,
      }
    case 'verification.completed':
      if (
        !hasOnlyFields(value, [...commonFields, 'artifactHash', 'passed']) ||
        !isHash(value['artifactHash']) ||
        typeof value['passed'] !== 'boolean'
      ) {
        return refusal('malformed-event-log')
      }
      return {
        event: {
          ...base,
          artifactHash: value['artifactHash'],
          passed: value['passed'],
          type: 'verification.completed',
        },
        index,
      }
    case 'payment.refused':
      if (
        !hasOnlyFields(value, [...commonFields, 'artifactHash', 'reason', 'wdkInvoked']) ||
        !isHash(value['artifactHash']) ||
        (value['reason'] !== 'missing-exact-payment-authorization' &&
          value['reason'] !== 'verification-failed') ||
        value['wdkInvoked'] !== false
      ) {
        return refusal('malformed-event-log')
      }
      return {
        event: {
          ...base,
          artifactHash: value['artifactHash'],
          reason: value['reason'],
          type: 'payment.refused',
          wdkInvoked: false,
        },
        index,
      }
    case 'settlement.refusal-recorded':
      if (
        !hasOnlyFields(value, [
          ...commonFields,
          'artifactHash',
          'paymentStatus',
          'verificationStatus',
        ]) ||
        !isHash(value['artifactHash']) ||
        value['paymentStatus'] !== 'refused' ||
        (value['verificationStatus'] !== 'failed' && value['verificationStatus'] !== 'passed')
      ) {
        return refusal('malformed-event-log')
      }
      return {
        event: {
          ...base,
          artifactHash: value['artifactHash'],
          paymentStatus: 'refused',
          type: 'settlement.refusal-recorded',
          verificationStatus: value['verificationStatus'],
        },
        index,
      }
    case 'reputation.updated':
      if (
        !hasOnlyFields(value, [...commonFields, 'delta', 'reason']) ||
        (value['delta'] !== -1 && value['delta'] !== 1) ||
        (value['reason'] !== 'failed-verification' && value['reason'] !== 'verified-delivery')
      ) {
        return refusal('malformed-event-log')
      }
      return {
        event: {
          ...base,
          delta: value['delta'],
          reason: value['reason'],
          type: 'reputation.updated',
        },
        index,
      }
    default:
      return refusal('malformed-event-log')
  }
}

const eventFingerprint = (event: RecordedEvent): string => JSON.stringify(event)

const jobFor = (
  jobs: Map<string, MutableJobProjection>,
  event: RecordedEvent,
): MutableJobProjection => {
  const existing = jobs.get(event.jobId)
  if (existing !== undefined) return existing

  const created: MutableJobProjection = {
    jobId: event.jobId,
    payment: { _tag: 'not-recorded' },
    verification: 'unobserved',
    workspace: event.workspace,
  }
  jobs.set(event.jobId, created)
  return created
}

export const projectEventLog = (text: string, observedAt: Date): BrowserProjectionResult => {
  if (utf8Length(text) > MAX_EVENT_LOG_BYTES) return refusal('event-log-too-large')

  const lines = text.split('\n').filter((line) => line.trim().length > 0)
  if (lines.length > MAX_EVENT_LINES) return refusal('too-many-events')

  const parsedEvents: ParsedEvent[] = []
  for (const [index, line] of lines.entries()) {
    if (utf8Length(line) > MAX_EVENT_LINE_BYTES) return refusal('event-log-too-large')

    const decoded = Effect.runSync(Effect.either(decodeLine(line)))
    if (Either.isLeft(decoded)) return decoded.left

    const parsed = parseEvent(decoded.right, observedAt, index)
    if ('_tag' in parsed) return parsed
    parsedEvents.push(parsed)
  }

  const fingerprints = new Set<string>()
  const uniqueEvents = parsedEvents
    .sort(
      (left, right) =>
        Date.parse(left.event.recordedAt) - Date.parse(right.event.recordedAt) ||
        left.index - right.index,
    )
    .filter((event) => {
      const fingerprint = eventFingerprint(event.event)
      if (fingerprints.has(fingerprint)) return false
      fingerprints.add(fingerprint)
      return true
    })
  const agents = new Map<string, BrowserAgentProjection>()
  const jobs = new Map<string, MutableJobProjection>()

  for (const { event } of uniqueEvents) {
    const job = jobFor(jobs, event)
    switch (event.type) {
      case 'provider.started':
        agents.set(event.profile, {
          profile: event.profile,
          role: 'provider',
          source: 'live-agent-run',
        })
        job.providerProfile = event.profile
        break
      case 'provider.artifact-submitted':
        agents.set(event.profile, {
          profile: event.profile,
          role: 'provider',
          source: 'live-agent-run',
        })
        job.artifactHash = event.artifactHash
        job.providerProfile = event.profile
        break
      case 'verification.completed':
        job.artifactHash = event.artifactHash
        job.verification = event.passed ? 'passed' : 'failed'
        break
      case 'payment.refused':
        job.artifactHash = event.artifactHash
        job.payment = {
          _tag: 'refused',
          reason: event.reason,
          wdkInvoked: event.wdkInvoked,
        }
        break
      case 'reputation.updated':
      case 'settlement.refusal-recorded':
        break
    }
  }

  return {
    _tag: 'projection',
    agents: [...agents.values()].sort((left, right) => left.profile.localeCompare(right.profile)),
    events: uniqueEvents.map(({ event }) => ({
      freshness: event.freshness,
      jobId: event.jobId,
      recordedAt: event.recordedAt,
      type: event.type,
    })),
    jobs: [...jobs.values()].sort((left, right) => left.jobId.localeCompare(right.jobId)),
    unobserved: ['capability discovery', 'signed terms'],
  }
}

import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'

export type SettlementFailure = Readonly<{
  readonly _tag: 'invalid-event-log' | 'verification-not-found'
  readonly reason: string
}>

export type VerificationObservation = Readonly<{
  readonly artifactHash: string
  readonly evidenceHash: string
  readonly jobId: string
  readonly passed: boolean
  readonly termsHash: string
  readonly verifierHash: string
  readonly workspace: string
}>

export type SettlementEvent =
  | Readonly<{
      readonly artifactHash: string
      readonly evidenceSource: 'live-agent-run'
      readonly jobId: string
      readonly reason: 'missing-exact-payment-authorization' | 'verification-failed'
      readonly termsHash: string
      readonly type: 'payment.refused'
      readonly wdkInvoked: false
      readonly workspace: string
    }>
  | Readonly<{
      readonly artifactHash: string
      readonly evidenceSource: 'live-agent-run'
      readonly jobId: string
      readonly paymentStatus: 'refused'
      readonly termsHash: string
      readonly type: 'settlement.refusal-recorded'
      readonly verificationStatus: 'failed' | 'passed'
      readonly workspace: string
    }>
  | Readonly<{
      readonly delta: -1 | 1
      readonly evidenceSource: 'live-agent-run'
      readonly jobId: string
      readonly reason: 'failed-verification' | 'verified-delivery'
      readonly termsHash: string
      readonly type: 'reputation.updated'
      readonly workspace: string
    }>

type DecodedEvent =
  | Readonly<{ readonly _tag: 'other' }>
  | Readonly<{ readonly _tag: 'verification'; readonly value: VerificationObservation }>

type DecodedSettlementEvent =
  | Readonly<{ readonly _tag: 'other' }>
  | Readonly<{ readonly _tag: 'settlement'; readonly value: SettlementEvent }>

const BoundedEventText = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1_024))
const EventArtifactHash = Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/))
const EventRecordedAt = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
)
const SettlementEventCommon = {
  evidenceSource: Schema.Literal('live-agent-run'),
  jobId: BoundedEventText,
  recordedAt: EventRecordedAt,
  schemaVersion: Schema.Literal(1),
  termsHash: EventArtifactHash,
  workspace: BoundedEventText,
} as const
const RecordedSettlementEventSchema = Schema.Union(
  Schema.Struct({
    ...SettlementEventCommon,
    artifactHash: EventArtifactHash,
    reason: Schema.Literal('missing-exact-payment-authorization', 'verification-failed'),
    type: Schema.Literal('payment.refused'),
    wdkInvoked: Schema.Literal(false),
  }),
  Schema.Struct({
    ...SettlementEventCommon,
    artifactHash: EventArtifactHash,
    paymentStatus: Schema.Literal('refused'),
    type: Schema.Literal('settlement.refusal-recorded'),
    verificationStatus: Schema.Literal('failed', 'passed'),
  }),
  Schema.Struct({
    ...SettlementEventCommon,
    delta: Schema.Literal(-1, 1),
    reason: Schema.Literal('failed-verification', 'verified-delivery'),
    type: Schema.Literal('reputation.updated'),
  }),
)
type RecordedSettlementEvent = typeof RecordedSettlementEventSchema.Type

const failure = (tag: SettlementFailure['_tag'], reason: string): SettlementFailure => ({
  _tag: tag,
  reason,
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const decodeEvent = (
  line: string,
  workspace: string,
): Effect.Effect<DecodedEvent, SettlementFailure> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.option(
      Effect.try({
        try: (): unknown => JSON.parse(line),
        catch: () => failure('invalid-event-log', 'event log contains malformed JSON'),
      }),
    )
    if (parsed._tag === 'None') return { _tag: 'other' }
    const value = parsed.value
    if (
      !isRecord(value) ||
      value['type'] !== 'verification.completed' ||
      value['workspace'] !== workspace
    ) {
      return { _tag: 'other' }
    }

    if (
      value['schemaVersion'] !== 1 ||
      value['evidenceSource'] !== 'live-agent-run' ||
      typeof value['artifactHash'] !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value['artifactHash']) ||
      typeof value['evidenceHash'] !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value['evidenceHash']) ||
      typeof value['jobId'] !== 'string' ||
      value['jobId'].trim().length === 0 ||
      typeof value['passed'] !== 'boolean' ||
      typeof value['termsHash'] !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value['termsHash']) ||
      typeof value['verifierHash'] !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value['verifierHash']) ||
      typeof value['recordedAt'] !== 'string' ||
      !Number.isFinite(Date.parse(value['recordedAt'])) ||
      typeof value['workspace'] !== 'string' ||
      value['workspace'].trim().length === 0
    ) {
      return yield* Effect.fail(
        failure('invalid-event-log', 'verification event violates the live evidence contract'),
      )
    }

    return {
      _tag: 'verification',
      value: {
        artifactHash: value['artifactHash'],
        evidenceHash: value['evidenceHash'],
        jobId: value['jobId'],
        passed: value['passed'],
        termsHash: value['termsHash'],
        verifierHash: value['verifierHash'],
        workspace: value['workspace'],
      },
    }
  })

export const decodeLatestVerification = (
  text: string,
  workspace: string,
): Effect.Effect<VerificationObservation, SettlementFailure> =>
  Effect.gen(function* () {
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    const events = yield* Effect.forEach(lines, (line) => decodeEvent(line, workspace))
    const verifications = events.filter(
      (event): event is Extract<DecodedEvent, { readonly _tag: 'verification' }> =>
        event._tag === 'verification',
    )
    const verification = verifications.at(-1)
    if (verification === undefined) {
      return yield* Effect.fail(
        failure('verification-not-found', 'no live verification exists for the workspace'),
      )
    }
    if (
      verifications.some(
        (candidate) =>
          candidate.value.artifactHash !== verification.value.artifactHash ||
          candidate.value.termsHash !== verification.value.termsHash ||
          candidate.value.verifierHash !== verification.value.verifierHash,
      )
    ) {
      return yield* Effect.fail(
        failure('invalid-event-log', 'workspace has conflicting verification bindings'),
      )
    }
    return verification.value
  })

export const deriveSettlementEvents = (
  verification: VerificationObservation,
): readonly [SettlementEvent, SettlementEvent, SettlementEvent] => {
  const verificationStatus = verification.passed ? 'passed' : 'failed'
  return [
    {
      artifactHash: verification.artifactHash,
      evidenceSource: 'live-agent-run',
      jobId: verification.jobId,
      reason: verification.passed ? 'missing-exact-payment-authorization' : 'verification-failed',
      termsHash: verification.termsHash,
      type: 'payment.refused',
      wdkInvoked: false,
      workspace: verification.workspace,
    },
    {
      artifactHash: verification.artifactHash,
      evidenceSource: 'live-agent-run',
      jobId: verification.jobId,
      paymentStatus: 'refused',
      termsHash: verification.termsHash,
      type: 'settlement.refusal-recorded',
      verificationStatus,
      workspace: verification.workspace,
    },
    {
      delta: verification.passed ? 1 : -1,
      evidenceSource: 'live-agent-run',
      jobId: verification.jobId,
      reason: verification.passed ? 'verified-delivery' : 'failed-verification',
      termsHash: verification.termsHash,
      type: 'reputation.updated',
      workspace: verification.workspace,
    },
  ]
}

const isSettlementEventType = (value: unknown): value is SettlementEvent['type'] =>
  value === 'payment.refused' ||
  value === 'settlement.refusal-recorded' ||
  value === 'reputation.updated'

const toSettlementEvent = (event: RecordedSettlementEvent): SettlementEvent => {
  if (event.type === 'payment.refused') {
    return {
      artifactHash: event.artifactHash,
      evidenceSource: event.evidenceSource,
      jobId: event.jobId,
      reason: event.reason,
      termsHash: event.termsHash,
      type: event.type,
      wdkInvoked: event.wdkInvoked,
      workspace: event.workspace,
    }
  }
  if (event.type === 'settlement.refusal-recorded') {
    return {
      artifactHash: event.artifactHash,
      evidenceSource: event.evidenceSource,
      jobId: event.jobId,
      paymentStatus: event.paymentStatus,
      termsHash: event.termsHash,
      type: event.type,
      verificationStatus: event.verificationStatus,
      workspace: event.workspace,
    }
  }
  return {
    delta: event.delta,
    evidenceSource: event.evidenceSource,
    jobId: event.jobId,
    reason: event.reason,
    termsHash: event.termsHash,
    type: event.type,
    workspace: event.workspace,
  }
}

const decodeSettlementEvent = (
  line: string,
  workspace: string,
): Effect.Effect<DecodedSettlementEvent, SettlementFailure> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.option(
      Effect.try({
        try: (): unknown => JSON.parse(line),
        catch: () => failure('invalid-event-log', 'event log contains malformed JSON'),
      }),
    )
    if (parsed._tag === 'None') return { _tag: 'other' }
    const value = parsed.value
    if (
      !isRecord(value) ||
      value['workspace'] !== workspace ||
      !isSettlementEventType(value['type'])
    ) {
      return { _tag: 'other' }
    }

    const event = yield* Schema.decodeUnknown(RecordedSettlementEventSchema)(value).pipe(
      Effect.mapError(() =>
        failure('invalid-event-log', 'settlement event violates the live evidence contract'),
      ),
    )
    return { _tag: 'settlement', value: toSettlementEvent(event) }
  })

const settlementEventsEqual = (left: SettlementEvent, right: SettlementEvent): boolean => {
  if (left.type !== right.type) return false
  if (
    left.jobId !== right.jobId ||
    left.termsHash !== right.termsHash ||
    left.workspace !== right.workspace
  ) {
    return false
  }
  if (left.type === 'payment.refused' && right.type === 'payment.refused') {
    return left.artifactHash === right.artifactHash && left.reason === right.reason
  }
  if (left.type === 'settlement.refusal-recorded' && right.type === 'settlement.refusal-recorded') {
    return (
      left.artifactHash === right.artifactHash &&
      left.verificationStatus === right.verificationStatus
    )
  }
  return (
    left.type === 'reputation.updated' &&
    right.type === 'reputation.updated' &&
    left.delta === right.delta &&
    left.reason === right.reason
  )
}

export const selectSettlementEventsToAppend = (
  eventLog: string,
  verification: VerificationObservation,
): Effect.Effect<readonly SettlementEvent[], SettlementFailure> =>
  Effect.gen(function* () {
    const expected = deriveSettlementEvents(verification)
    const lines = eventLog
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    const decoded = yield* Effect.forEach(lines, (line) =>
      decodeSettlementEvent(line, verification.workspace),
    )
    const presentTypes = new Set<SettlementEvent['type']>()

    for (const event of decoded) {
      if (event._tag === 'other') continue
      const matching = expected.find((candidate) => candidate.type === event.value.type)
      if (matching === undefined || !settlementEventsEqual(event.value, matching)) {
        return yield* Effect.fail(
          failure(
            'invalid-event-log',
            'settlement event conflicts with the latest live verification',
          ),
        )
      }
      presentTypes.add(event.value.type)
    }

    return expected.filter((event) => !presentTypes.has(event.type))
  })

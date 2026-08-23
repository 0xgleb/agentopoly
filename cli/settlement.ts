import * as Effect from 'effect/Effect'

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
    const verification = events.findLast(
      (event): event is Extract<DecodedEvent, { readonly _tag: 'verification' }> =>
        event._tag === 'verification' && event.value.workspace === workspace,
    )
    if (verification === undefined) {
      return yield* Effect.fail(
        failure('verification-not-found', 'no live verification exists for the workspace'),
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

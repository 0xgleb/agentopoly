import { expect, test } from 'bun:test'
import * as Either from 'effect/Either'
import * as Effect from 'effect/Effect'

import {
  createDashboardProjectionStore,
  decodeDashboardProjection,
} from '../../dashboard/projection.ts'
import { submitLocalDashboardCommand } from '../../dashboard/local-command.ts'
import { renderDashboard } from '../../dashboard/render.ts'

const recordedProjection = {
  agents: [
    {
      availability: 'available',
      id: 'buyer-01',
      label: 'Buyer',
      role: 'buyer',
      selectionEvidence: 'local policy chooses verified evidence only',
    },
    {
      availability: 'available',
      id: 'provider-reliable-01',
      label: 'Reliable provider',
      role: 'provider',
      selectionEvidence: '1 verified receipt',
    },
    {
      availability: 'available',
      id: 'provider-bad-01',
      label: 'Bad provider',
      role: 'provider',
      selectionEvidence: '1 failed verification',
    },
    {
      availability: 'available',
      id: 'arbitrator-01',
      label: 'Arbitrator',
      role: 'arbitrator',
      selectionEvidence: 'paid evidence review service',
    },
  ],
  freshness: 'fresh',
  generatedAt: '2026-08-22T21:00:00.000Z',
  jobs: [
    {
      artifactReference: 'artifact:sha256:reliable',
      evidenceReference: 'evidence:sha256:reliable',
      id: 'job-reliable-01',
      payment: 'receipted',
      phase: 'verified',
      providerId: 'provider-reliable-01',
      settlement: 'settled',
      termsReference: 'terms:sha256:reliable',
      title: 'Repair deterministic fixture',
      verification: 'passed',
    },
    {
      artifactReference: 'artifact:sha256:bad',
      evidenceReference: 'evidence:sha256:bad',
      id: 'job-bad-01',
      payment: 'withheld',
      phase: 'disputed',
      providerId: 'provider-bad-01',
      settlement: 'not-broadcast',
      termsReference: 'terms:sha256:bad',
      title: 'Repair adversarial fixture',
      verification: 'failed',
    },
    {
      artifactReference: 'ruling:sha256:arbitrator',
      evidenceReference: 'evidence:sha256:arbitration',
      id: 'job-arbitration-01',
      payment: 'receipted',
      phase: 'ruled',
      providerId: 'arbitrator-01',
      settlement: 'observed',
      termsReference: 'terms:sha256:arbitration',
      title: 'Arbitrate failed delivery',
      verification: 'passed',
    },
  ],
  revision: '3',
}

const decodedRecordedProjection = (): Promise<
  import('../../dashboard/projection.ts').DashboardProjection
> => Effect.runPromise(decodeDashboardProjection(recordedProjection))

test('renders distinct agents, evidence-backed economy states, and redacted evidence', async () => {
  const view = renderDashboard(await decodedRecordedProjection())

  expect(view).toContain('Reliable provider')
  expect(view).toContain('Bad provider')
  expect(view).toContain('Arbitrator')
  expect(view).toContain('Verification passed')
  expect(view).toContain('Payment withheld')
  expect(view).toContain('Settlement not broadcast')
  expect(view).toContain('evidence:sha256:bad')
  expect(view).toContain('LOCAL EVIDENCE PROJECTION')
  expect(view).toContain('Generated 2026-08-22T21:00:00.000Z')
  expect(view).not.toContain('Live local projection')
  expect(view).not.toContain('Payment settled')
})

test('fails closed on malformed, stale, duplicate, and out-of-order projections', async () => {
  const malformed = await Effect.runPromise(
    Effect.either(decodeDashboardProjection({ revision: 4 })),
  )
  expect(malformed).toMatchObject({
    _tag: 'Left',
    left: { _tag: 'invalid-dashboard-projection' },
  })

  const failedVerifiedJob = await Effect.runPromise(
    Effect.either(
      decodeDashboardProjection({
        ...recordedProjection,
        jobs: [
          {
            ...recordedProjection.jobs[1],
            phase: 'verified',
            verification: 'failed',
          },
        ],
      }),
    ),
  )
  expect(Either.isLeft(failedVerifiedJob)).toBe(true)

  const failedVerificationWithReceipt = await Effect.runPromise(
    Effect.either(
      decodeDashboardProjection({
        ...recordedProjection,
        jobs: [{ ...recordedProjection.jobs[0], verification: 'failed', settlement: 'settled' }],
      }),
    ),
  )
  expect(Either.isLeft(failedVerificationWithReceipt)).toBe(true)

  const contradictorySettlement = await Effect.runPromise(
    Effect.either(
      decodeDashboardProjection({
        ...recordedProjection,
        jobs: [
          { ...recordedProjection.jobs[0], payment: 'receipted', settlement: 'not-broadcast' },
        ],
      }),
    ),
  )
  expect(Either.isLeft(contradictorySettlement)).toBe(true)

  const reconciliationPending = await Effect.runPromise(
    Effect.either(
      decodeDashboardProjection({
        ...recordedProjection,
        jobs: [
          {
            ...recordedProjection.jobs[0],
            payment: 'undetermined',
            phase: 'reconciliation',
            settlement: 'reconciliation-pending',
            verification: 'not-run',
          },
        ],
      }),
    ),
  )
  expect(Either.isRight(reconciliationPending)).toBe(true)

  const duplicateAgent = await Effect.runPromise(
    Effect.either(
      decodeDashboardProjection({
        ...recordedProjection,
        agents: [...recordedProjection.agents, recordedProjection.agents[0]],
      }),
    ),
  )
  const unknownProvider = await Effect.runPromise(
    Effect.either(
      decodeDashboardProjection({
        ...recordedProjection,
        jobs: [{ ...recordedProjection.jobs[0], providerId: 'missing-provider' }],
      }),
    ),
  )
  expect(Either.isLeft(duplicateAgent)).toBe(true)
  expect(Either.isLeft(unknownProvider)).toBe(true)

  const projection = await decodedRecordedProjection()
  const staleProjection = await Effect.runPromise(
    decodeDashboardProjection({ ...recordedProjection, freshness: 'stale', revision: '2' }),
  )
  const store = createDashboardProjectionStore(projection)
  const duplicate = await Effect.runPromise(Effect.either(store.publish(projection)))
  const stale = await Effect.runPromise(Effect.either(store.publish(staleProjection)))

  expect(Either.isRight(duplicate)).toBe(true)
  expect(stale).toMatchObject({
    _tag: 'Left',
    left: { _tag: 'out-of-order-dashboard-projection' },
  })
  expect(store.current()).toEqual(projection)
})

test('refuses unauthorized and payment-like browser commands without dispatching authority', async () => {
  let dispatched = 0
  const submit = submitLocalDashboardCommand({
    authorize: () => Effect.succeed(false),
    dispatch: () =>
      Effect.sync(() => {
        dispatched += 1
      }),
  })

  const unauthorized = await Effect.runPromise(Effect.either(submit({ type: 'request-refresh' })))
  const paymentLike = await Effect.runPromise(Effect.either(submit({ type: 'authorize-payment' })))

  expect(unauthorized).toMatchObject({
    _tag: 'Left',
    left: { _tag: 'unauthorized-dashboard-command' },
  })
  expect(paymentLike).toMatchObject({
    _tag: 'Left',
    left: { _tag: 'unsupported-dashboard-command' },
  })
  expect(dispatched).toBe(0)
})

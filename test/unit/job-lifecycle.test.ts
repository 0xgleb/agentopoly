import { describe, expect, test } from 'bun:test'
import * as Either from 'effect/Either'
import * as Effect from 'effect/Effect'

import {
  applyJobEvent,
  createAgreedJob,
  EvidenceHash,
  ParticipantId,
  projectProviderReputation,
  toJobProjection,
  type AgreedJob,
  type JobLifecycleFailure,
} from '../../economy/job-lifecycle.ts'

const hash = (character: string): EvidenceHash => EvidenceHash(character.repeat(64))

const agreedTerms = (jobId: string, provider: string) => ({
  agreementHash: hash('a'),
  asset: 'USDt',
  atomicAmount: '1500000',
  buyer: 'buyer-1',
  destination: `${provider}-wallet`,
  jobId,
  network: 'demo-network',
  provider,
})

const event = (kind: string, eventId: string, fields: Readonly<Record<string, unknown>>) => ({
  eventHash: hash((eventId.length % 10).toString()),
  eventId,
  kind,
  ...fields,
})

const run = <A>(effect: Effect.Effect<A, JobLifecycleFailure>): Promise<A> =>
  Effect.runPromise(effect)

const expectFailure = async <A>(
  effect: Effect.Effect<A, JobLifecycleFailure>,
  expectedTag: JobLifecycleFailure['_tag'],
): Promise<void> => {
  const result = await Effect.runPromise(Effect.either(effect))
  expect(Either.isLeft(result)).toBe(true)

  if (Either.isLeft(result)) {
    expect(result.left._tag).toBe(expectedTag)
  }
}

const recordGoodProviderOutcome = async (): Promise<AgreedJob> => {
  let job = await run(createAgreedJob(agreedTerms('job-good', 'provider-good')))

  job = await run(
    applyJobEvent(
      job,
      event('delivery-recorded', 'event-1', {
        artifactHash: hash('b'),
        jobId: 'job-good',
      }),
    ),
  )
  job = await run(
    applyJobEvent(
      job,
      event('verification-recorded', 'event-2', {
        artifactHash: hash('b'),
        jobId: 'job-good',
        passed: true,
        verificationHash: hash('c'),
      }),
    ),
  )

  return run(
    applyJobEvent(
      job,
      event('payment-receipt-recorded', 'event-3', {
        agreementHash: hash('a'),
        asset: 'USDt',
        atomicAmount: '1500000',
        beneficiary: 'provider-good',
        destination: 'provider-good-wallet',
        jobId: 'job-good',
        network: 'demo-network',
        purpose: 'provider',
        transactionHash: hash('d'),
        verificationHash: hash('c'),
      }),
    ),
  )
}

const recordBadProviderOutcome = async (): Promise<AgreedJob> => {
  let job = await run(createAgreedJob(agreedTerms('job-bad', 'provider-bad')))

  job = await run(
    applyJobEvent(
      job,
      event('delivery-recorded', 'bad-event-1', {
        artifactHash: hash('e'),
        jobId: 'job-bad',
      }),
    ),
  )
  job = await run(
    applyJobEvent(
      job,
      event('verification-recorded', 'bad-event-2', {
        artifactHash: hash('e'),
        jobId: 'job-bad',
        passed: false,
        verificationHash: hash('f'),
      }),
    ),
  )
  job = await run(
    applyJobEvent(
      job,
      event('dispute-opened', 'bad-event-3', {
        disputeHash: hash('1'),
        jobId: 'job-bad',
        verificationHash: hash('f'),
      }),
    ),
  )
  job = await run(
    applyJobEvent(
      job,
      event('arbitration-hired', 'bad-event-4', {
        arbitrator: 'arbitrator-1',
        arbitrationJobId: 'arbitration-job-1',
        asset: 'USDt',
        atomicAmount: '250000',
        beneficiary: 'arbitrator-1',
        disputeHash: hash('1'),
        jobId: 'job-bad',
        network: 'demo-network',
        purpose: 'arbitration',
        transactionHash: hash('2'),
      }),
    ),
  )

  return run(
    applyJobEvent(
      job,
      event('ruling-recorded', 'bad-event-5', {
        arbitrator: 'arbitrator-1',
        disputeHash: hash('1'),
        jobId: 'job-bad',
        rulingHash: hash('3'),
        winner: 'buyer',
      }),
    ),
  )
}

describe('agent economy job lifecycle', () => {
  test('records exact payment evidence for a verified reliable provider', async () => {
    const job = await recordGoodProviderOutcome()

    expect(job.stage._tag).toBe('paid')
    if (job.stage._tag === 'paid') {
      expect(job.stage.artifactHash).toBe(hash('b'))
      expect(job.stage.transactionHash).toBe(hash('d'))
      expect(job.stage.verificationHash).toBe(hash('c'))
    }
    expect(toJobProjection(job)).toEqual({
      evidenceSource: 'recorded-fixture',
      jobId: job.jobId,
      paymentStatus: 'paid',
      provider: job.provider,
      stage: 'paid',
    })
    expect(projectProviderReputation([job], ParticipantId('provider-good'))).toEqual({
      disputesLost: 0,
      failedDeliveries: 0,
      paidJobs: 1,
      provider: ParticipantId('provider-good'),
    })
  })

  test('withholds provider payment after failed verification and pays arbitration separately', async () => {
    let rejected = await run(createAgreedJob(agreedTerms('job-bad', 'provider-bad')))
    rejected = await run(
      applyJobEvent(
        rejected,
        event('delivery-recorded', 'bad-event-1', {
          artifactHash: hash('e'),
          jobId: 'job-bad',
        }),
      ),
    )
    rejected = await run(
      applyJobEvent(
        rejected,
        event('verification-recorded', 'bad-event-2', {
          artifactHash: hash('e'),
          jobId: 'job-bad',
          passed: false,
          verificationHash: hash('f'),
        }),
      ),
    )

    expect(toJobProjection(rejected).paymentStatus).toBe('withheld')
    await expectFailure(
      applyJobEvent(
        rejected,
        event('payment-receipt-recorded', 'bad-provider-payment', {
          agreementHash: hash('a'),
          asset: 'USDt',
          atomicAmount: '1500000',
          beneficiary: 'provider-bad',
          destination: 'provider-bad-wallet',
          jobId: 'job-bad',
          network: 'demo-network',
          purpose: 'provider',
          transactionHash: hash('9'),
          verificationHash: hash('f'),
        }),
      ),
      'invalid-transition',
    )

    const ruled = await recordBadProviderOutcome()
    expect(ruled.stage._tag).toBe('ruled')
    expect(toJobProjection(ruled).paymentStatus).toBe('withheld')
    expect(projectProviderReputation([ruled], ParticipantId('provider-bad'))).toEqual({
      disputesLost: 1,
      failedDeliveries: 1,
      paidJobs: 0,
      provider: ParticipantId('provider-bad'),
    })
  })

  test('rejects tampered, cross-job, and non-integer payment evidence', async () => {
    let job = await run(createAgreedJob(agreedTerms('job-good', 'provider-good')))
    job = await run(
      applyJobEvent(
        job,
        event('delivery-recorded', 'event-1', {
          artifactHash: hash('b'),
          jobId: 'job-good',
        }),
      ),
    )
    job = await run(
      applyJobEvent(
        job,
        event('verification-recorded', 'event-2', {
          artifactHash: hash('b'),
          jobId: 'job-good',
          passed: true,
          verificationHash: hash('c'),
        }),
      ),
    )

    await expectFailure(
      applyJobEvent(
        job,
        event('payment-receipt-recorded', 'event-3', {
          agreementHash: hash('a'),
          asset: 'USDt',
          atomicAmount: '1500001',
          beneficiary: 'provider-good',
          destination: 'attacker-wallet',
          jobId: 'another-job',
          network: 'demo-network',
          purpose: 'provider',
          transactionHash: hash('d'),
          verificationHash: hash('c'),
        }),
      ),
      'evidence-mismatch',
    )

    await expectFailure(
      createAgreedJob({ ...agreedTerms('decimal-job', 'provider-good'), atomicAmount: '1.5' }),
      'invalid-terms',
    )
  })

  test('returns identical duplicate evidence and rejects a conflicting event id', async () => {
    const job = await run(createAgreedJob(agreedTerms('job-idempotent', 'provider-good')))
    const delivery = event('delivery-recorded', 'event-duplicate-1', {
      artifactHash: hash('4'),
      jobId: 'job-idempotent',
    })
    const delivered = await run(applyJobEvent(job, delivery))
    const duplicate = await run(applyJobEvent(delivered, delivery))

    expect(duplicate).toBe(delivered)

    await expectFailure(
      applyJobEvent(delivered, {
        ...delivery,
        artifactHash: hash('5'),
        eventHash: hash('5'),
      }),
      'conflicting-event',
    )
  })
})

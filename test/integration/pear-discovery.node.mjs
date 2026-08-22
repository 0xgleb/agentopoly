import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'

import createTestnet from 'hyperdht/testnet.js'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'

import { createCapabilityMarket } from '../../market/capability-market.ts'
import {
  admitEnvelope,
  createInMemoryReplayStore,
  decodeEnvelope,
  encodeEnvelope,
} from '../../protocol/envelope-boundary.ts'
import {
  BareWorkerEntrypoint,
  createPearWorker,
  LocalDhtBootstrap,
  PearDataDirectory,
} from '../../participant/pear-worker.ts'

const require = createRequire(import.meta.url)
const PearRuntime = require('pear-runtime')
const workerEntrypoint = new URL('../../participant/worker.js', import.meta.url).pathname

const field = (value) => [0, value.length, ...Buffer.from(value)]
const u64 = (value) => {
  const bytes = Buffer.alloc(8)
  bytes.writeBigUInt64BE(BigInt(value))
  return [...bytes]
}

const capabilityPayload = ({
  expiresAt,
  priceBasis = '1000 atomic USDt',
  providerIdentity,
  revision,
  withdrawal,
}) =>
  Uint8Array.from([
    1,
    withdrawal ? 1 : 0,
    ...u64(expiresAt),
    ...u64(revision),
    ...field('coding.fixture'),
    ...field(providerIdentity),
    ...field('typescript patch'),
    ...field('validated patch artifact'),
    ...field('one file'),
    ...field(priceBasis),
    ...field('one verified receipt'),
  ])

const capabilityEnvelope = ({
  expiresAt,
  messageId,
  nonce,
  priceBasis,
  providerIdentity = 'provider-a',
  revision,
  senderIdentity = providerIdentity,
  withdrawal,
}) =>
  encodeEnvelope({
    audience: 'buyer-a',
    compression: 0,
    correlationId: 'capability-a',
    expiresAt: 1_200,
    keyRevision: 'key-a',
    kind: 'capability.advertise',
    messageId,
    nonce,
    payload: capabilityPayload({
      expiresAt,
      priceBasis,
      providerIdentity,
      revision,
      withdrawal,
    }),
    senderIdentity,
    sentAt: 1_000,
    signature: Uint8Array.of(1),
    version: 1,
  })

const createRuntime = () => {
  let sidecar
  return {
    close: async () => sidecar?.destroy(),
    ready: async () => undefined,
    run: (entrypoint, args) => {
      sidecar = PearRuntime.run(entrypoint, args)
      return sidecar
    },
  }
}

test('two real Pear hosts admit a signed capability envelope into the local market', async () => {
  const encoded = capabilityEnvelope({
    expiresAt: 1_300,
    messageId: 'capability-message-a',
    nonce: 1,
    revision: 1,
    withdrawal: false,
  })
  assert.equal(encoded.ok, true)
  if (!encoded.ok) return

  const testnet = await createTestnet(3)
  const bootstrap = testnet.bootstrap[0]
  assert.notEqual(bootstrap, undefined)
  const localDhtBootstrap = LocalDhtBootstrap(`${bootstrap.host}:${bootstrap.port}`)
  const market = createCapabilityMarket()
  const replayStore = createInMemoryReplayStore()
  const first = createPearWorker(
    {
      dataDirectory: PearDataDirectory('.tmp/pear-discovery/first'),
      localDhtBootstrap,
      localDiscoveryRole: 'server',
      onAcceptedPeerEnvelope: (envelope) => market.applyEnvelope(envelope, 1_050),
      peerFrameAdmission: (frame) => {
        const decoded = decodeEnvelope(frame, {
          now: 1_050,
          verify: () => ({ ok: true, value: undefined }),
        })
        if (!decoded.ok) return decoded
        const admitted = admitEnvelope(decoded.value, frame, 'accepted', replayStore)
        return admitted.ok ? decoded : admitted
      },
      startupTimeout: Duration.seconds(10),
      workerEntrypoint: BareWorkerEntrypoint(workerEntrypoint),
    },
    createRuntime,
  )
  let second = createPearWorker(
    {
      dataDirectory: PearDataDirectory('.tmp/pear-discovery/second'),
      localDhtBootstrap,
      localDiscoveryRole: 'client',
      startupTimeout: Duration.seconds(10),
      workerEntrypoint: BareWorkerEntrypoint(workerEntrypoint),
    },
    createRuntime,
  )

  try {
    await Effect.runPromise(first.start)
    await Effect.runPromise(second.start)
    await Effect.runPromise(second.advertise(Uint8Array.of(0)))
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(market.live(1_050).length, 0)
    for (let attempt = 0; attempt < 100 && market.live(1_050).length === 0; attempt += 1) {
      await Effect.runPromise(second.advertise(encoded.value))
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    const secondProvider = capabilityEnvelope({
      expiresAt: 1_300,
      messageId: 'capability-message-b',
      nonce: 1,
      providerIdentity: 'provider-b',
      revision: 1,
      withdrawal: false,
    })
    assert.equal(secondProvider.ok, true)
    if (!secondProvider.ok) return
    for (let attempt = 0; attempt < 100 && market.live(1_050).length < 2; attempt += 1) {
      await Effect.runPromise(second.advertise(secondProvider.value))
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.deepEqual(
      market
        .live(1_050)
        .map((advertisement) => advertisement.providerIdentity)
        .sort(),
      ['provider-a', 'provider-b'],
    )
    const forged = capabilityEnvelope({
      expiresAt: 1_300,
      messageId: 'capability-forged-a',
      nonce: 2,
      revision: 2,
      senderIdentity: 'forged-provider',
      withdrawal: false,
    })
    assert.equal(forged.ok, true)
    if (!forged.ok) return
    await Effect.runPromise(second.advertise(forged.value))
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(
      market.live(1_050).find((item) => item.providerIdentity === 'provider-a')?.revision,
      1,
    )
    await Effect.runPromise(second.advertise(encoded.value))
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(
      market.live(1_050).find((item) => item.providerIdentity === 'provider-a')?.revision,
      1,
    )
    const replayed = capabilityEnvelope({
      expiresAt: 1_300,
      messageId: 'capability-replayed-a',
      nonce: 1,
      priceBasis: '3000 atomic USDt',
      revision: 3,
      withdrawal: false,
    })
    assert.equal(replayed.ok, true)
    if (!replayed.ok) return
    await Effect.runPromise(second.advertise(replayed.value))
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(
      market.live(1_050).find((item) => item.providerIdentity === 'provider-a')?.priceBasis,
      '1000 atomic USDt',
    )
    const conflict = capabilityEnvelope({
      expiresAt: 1_300,
      messageId: 'capability-conflict-a',
      nonce: 3,
      priceBasis: '2000 atomic USDt',
      revision: 1,
      withdrawal: false,
    })
    assert.equal(conflict.ok, true)
    if (!conflict.ok) return
    await Effect.runPromise(second.advertise(conflict.value))
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(
      market.live(1_050).find((item) => item.providerIdentity === 'provider-a')?.priceBasis,
      '1000 atomic USDt',
    )

    const withdrawal = capabilityEnvelope({
      expiresAt: 1_300,
      messageId: 'capability-withdrawal-a',
      nonce: 4,
      revision: 2,
      withdrawal: true,
    })
    assert.equal(withdrawal.ok, true)
    if (!withdrawal.ok) return
    for (
      let attempt = 0;
      attempt < 100 && market.live(1_050).some((item) => item.providerIdentity === 'provider-a');
      attempt += 1
    ) {
      await Effect.runPromise(second.advertise(withdrawal.value))
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.deepEqual(
      market.live(1_050).map((item) => item.providerIdentity),
      ['provider-b'],
    )

    await Effect.runPromise(second.shutdown)
    second = createPearWorker(
      {
        dataDirectory: PearDataDirectory('.tmp/pear-discovery/second-reconnected'),
        localDhtBootstrap,
        localDiscoveryRole: 'client',
        startupTimeout: Duration.seconds(10),
        workerEntrypoint: BareWorkerEntrypoint(workerEntrypoint),
      },
      createRuntime,
    )
    await Effect.runPromise(second.start)
    const refreshed = capabilityEnvelope({
      expiresAt: 1_060,
      messageId: 'capability-refreshed-a',
      nonce: 5,
      revision: 3,
      withdrawal: false,
    })
    assert.equal(refreshed.ok, true)
    if (!refreshed.ok) return
    for (
      let attempt = 0;
      attempt < 100 && !market.live(1_050).some((item) => item.providerIdentity === 'provider-a');
      attempt += 1
    ) {
      await Effect.runPromise(second.advertise(refreshed.value))
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(market.live(1_050).length, 2)
    assert.deepEqual(
      market.live(1_061).map((item) => item.providerIdentity),
      ['provider-b'],
    )
    assert.deepEqual(
      market.live(1_061).map((item) => item.providerIdentity),
      ['provider-b'],
    )
  } finally {
    await Effect.runPromise(first.shutdown)
    await Effect.runPromise(second.shutdown)
    await testnet.destroy()
  }
}, 30_000)

import assert from 'node:assert/strict'
import test from 'node:test'

import Hyperswarm from 'hyperswarm'
import createTestnet from 'hyperdht/testnet.js'

const topic = new Uint8Array(32).fill(7)

const connected = (swarm) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('local Hyperswarm connection timed out')),
      10_000,
    )
    swarm.once('connection', () => {
      clearTimeout(timer)
      resolve()
    })
  })

test('isolated local HyperDHT enables Hyperswarm discovery', async () => {
  const testnet = await createTestnet(3)
  const first = new Hyperswarm({ dht: testnet.createNode({ firewalled: false }) })
  const second = new Hyperswarm({ dht: testnet.createNode({ firewalled: false }) })

  try {
    const firstConnected = connected(first)
    const secondConnected = connected(second)
    const discovery = first.join(topic, { client: false, server: true })
    await discovery.flushed()
    second.join(topic, { client: true, server: false })
    await second.flush()
    await Promise.all([firstConnected, secondConnected])
    assert.equal(first.connections.size, 1)
    assert.equal(second.connections.size, 1)
  } finally {
    await first.destroy()
    await second.destroy()
    await testnet.destroy()
  }
}, 30_000)

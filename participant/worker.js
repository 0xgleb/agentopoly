import Hyperswarm from 'hyperswarm'
import { encodeNetworkFrame, encodePeerFrame } from './worker-frame.js'

const maximumFrameBytes = 65_536
const readyMessage = 'ready\n'
const shutdownMessage = 'shutdown'
const startupFailurePrefix = 'startup-failed:'
const discoveryTopic = Uint8Array.of(
  65,
  103,
  101,
  110,
  116,
  111,
  112,
  111,
  108,
  121,
  45,
  99,
  97,
  112,
  97,
  98,
  105,
  108,
  105,
  116,
  121,
  45,
  109,
  97,
  114,
  107,
  101,
  116,
  45,
  118,
  49,
  0,
)

let bufferedControl = ''
let hostFrames = new Uint8Array()
let swarm

const append = (left, right) => {
  const combined = new Uint8Array(left.byteLength + right.byteLength)
  combined.set(left)
  combined.set(right, left.byteLength)
  return combined
}

const u32 = (bytes) =>
  (((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0)) >>>
  0

const closeSwarm = async () => {
  if (swarm === undefined) return
  const current = swarm
  swarm = undefined
  await current.destroy()
}

const closeIpc = () => {
  void closeSwarm().finally(() => Bare.IPC.end())
}

const broadcast = (payload) => {
  const frame = encodeNetworkFrame(payload)
  for (const socket of swarm.connections) socket.write(frame)
}

const receiveControl = (chunk) => {
  for (const byte of chunk) {
    if (byte > 127) return
    bufferedControl += String.fromCharCode(byte)
  }
  for (
    let newline = bufferedControl.indexOf('\n');
    newline >= 0;
    newline = bufferedControl.indexOf('\n')
  ) {
    const message = bufferedControl.slice(0, newline)
    bufferedControl = bufferedControl.slice(newline + 1)
    if (message === shutdownMessage) closeIpc()
  }
}

const receiveHostFrames = (chunk) => {
  hostFrames = append(hostFrames, chunk)
  if (hostFrames.byteLength > maximumFrameBytes + 5) return closeIpc()
  while (hostFrames.byteLength >= 5) {
    const length = u32(hostFrames.slice(1, 5))
    if (hostFrames[0] !== 1 || length > maximumFrameBytes) return closeIpc()
    if (hostFrames.byteLength < length + 5) return
    const payload = hostFrames.slice(5, length + 5)
    hostFrames = hostFrames.slice(length + 5)
    broadcast(payload)
  }
}

const receiveHostInput = (chunk) => {
  const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
  if (hostFrames.byteLength > 0 || bytes[0] === 1) receiveHostFrames(bytes)
  else receiveControl(bytes)
}

const receivePeerFrames = (socket) => {
  let buffered = new Uint8Array()
  socket.on('data', (chunk) => {
    buffered = append(buffered, chunk)
    if (buffered.byteLength > maximumFrameBytes + 4) return socket.destroy()
    while (buffered.byteLength >= 4) {
      const length = u32(buffered.slice(0, 4))
      if (length > maximumFrameBytes) return socket.destroy()
      if (buffered.byteLength < length + 4) return
      Bare.IPC.write(encodePeerFrame(buffered.slice(4, length + 4)))
      buffered = buffered.slice(length + 4)
    }
  })
}

const start = () => {
  try {
    const bootstrap = Bare.argv.find((value) =>
      /^127\.0\.0\.1:(?:[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/.test(
        value,
      ),
    )
    swarm = new Hyperswarm({
      bootstrap: bootstrap === undefined ? undefined : [bootstrap],
      maxPeers: 64,
    })
    const discoveryRole = Bare.argv.find((value) => value === 'client' || value === 'server')
    const discoveryOptions =
      discoveryRole === 'client'
        ? { client: true, limit: 64, server: false }
        : discoveryRole === 'server'
          ? { client: false, limit: 64, server: true }
          : { client: true, limit: 64, server: true }
    swarm.on('connection', receivePeerFrames)
    const discovery = swarm.join(discoveryTopic, discoveryOptions)
    Bare.IPC.on('data', receiveHostInput)
    void discovery
      .flushed()
      .then(() => Bare.IPC.write(readyMessage))
      .catch(closeIpc)
  } catch {
    Bare.IPC.write(`${startupFailurePrefix}worker initialization failed\n`)
    closeIpc()
  }
}

start()

const maximumFrameBytes = 65_536

const u32 = (bytes) =>
  (((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0)) >>>
  0

export const decodeHostAdvertisementFrames = (bytes) => {
  const payloads = []
  let offset = 0

  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < 5 || bytes[offset] !== 1) {
      return { ok: false, error: 'invalid-frame' }
    }

    const length = u32(bytes.slice(offset + 1, offset + 5))
    if (length > maximumFrameBytes || bytes.byteLength - offset - 5 < length) {
      return { ok: false, error: 'invalid-frame' }
    }

    payloads.push(bytes.slice(offset + 5, offset + 5 + length))
    offset += length + 5
  }

  return { ok: true, value: payloads }
}

export const encodeNetworkFrame = (payload) => {
  const frame = new Uint8Array(payload.byteLength + 4)
  new DataView(frame.buffer).setUint32(0, payload.byteLength)
  frame.set(payload, 4)
  return frame
}

export const encodePeerFrame = (payload) => {
  const frame = new Uint8Array(payload.byteLength + 5)
  frame[0] = 2
  new DataView(frame.buffer).setUint32(1, payload.byteLength)
  frame.set(payload, 5)
  return frame
}

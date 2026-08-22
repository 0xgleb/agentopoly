export const protocolKinds = [
  'capability.advertise',
  'job.request',
  'job.bid',
  'job.agree',
  'job.accept',
  'job.delivery',
  'job.verification',
  'authorization.payment',
  'receipt.payment',
  'dispute.open',
  'dispute.evidence',
  'ruling.delivery',
] as const

export type ProtocolKind = (typeof protocolKinds)[number]
export type ProtocolFailure =
  | 'malformed-encoding'
  | 'limit-exceeded'
  | 'invalid-field'
  | 'unknown-version'
  | 'unknown-kind'
  | 'expired'
  | 'future-clock'
  | 'invalid-payload-hash'
  | 'invalid-signature'
  | 'invalid-identity'
  | 'duplicate'
  | 'id-conflict'
  | 'replayed'
export type Result<Value, Failure extends string = ProtocolFailure> =
  { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: Failure }
export type ProtocolEnvelope = Readonly<{
  version: 1
  kind: ProtocolKind
  compression: 0
  messageId: string
  senderIdentity: string
  audience: string
  keyRevision: string
  sentAt: number
  expiresAt: number
  correlationId: string
  nonce: number
  payload: Uint8Array
  evidence?: Uint8Array
  payloadHash: Uint8Array
  signature: Uint8Array
}>
export type EnvelopeInput = Omit<ProtocolEnvelope, 'payloadHash'>
export type DecodeContext = Readonly<{
  now: number
  verify: (
    envelope: ProtocolEnvelope,
    unsigned: Uint8Array,
  ) => Result<void, 'invalid-signature' | 'invalid-identity'>
}>

const frameLimit = 65_536
const evidenceLimit = 16_384
const identifierLimit = 256
const magic = Uint8Array.of(65, 79, 80)
const ok = <Value>(value: Value): Result<Value> => ({ ok: true, value })
const fail = <Failure extends ProtocolFailure>(error: Failure): Result<never, Failure> => ({
  ok: false,
  error,
})
const join = (parts: readonly Uint8Array[]): Uint8Array => {
  const length = parts.reduce((total, part) => total + part.length, 0)
  const output = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.length
  }
  return output
}
const u16 = (value: number): Uint8Array => Uint8Array.of(value >>> 8, value & 255)
const u32 = (value: number): Uint8Array =>
  Uint8Array.of(value >>> 24, value >>> 16, value >>> 8, value & 255)
const u64 = (value: number): Uint8Array =>
  join([u32(Math.floor(value / 4_294_967_296)), u32(value >>> 0)])
const encodeUtf8 = (value: string): Uint8Array | undefined => {
  const bytes: number[] = []
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index)
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1)
      if (second < 0xdc00 || second > 0xdfff) return undefined
      index += 1
      const codePoint = 0x10000 + ((first - 0xd800) << 10) + second - 0xdc00
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 63),
        0x80 | ((codePoint >>> 6) & 63),
        0x80 | (codePoint & 63),
      )
    } else if (first >= 0xdc00 && first <= 0xdfff) return undefined
    else if (first <= 0x7f) bytes.push(first)
    else if (first <= 0x7ff) bytes.push(0xc0 | (first >>> 6), 0x80 | (first & 63))
    else bytes.push(0xe0 | (first >>> 12), 0x80 | ((first >>> 6) & 63), 0x80 | (first & 63))
  }
  return Uint8Array.from(bytes)
}

const decodeUtf8 = (bytes: Uint8Array): string | undefined => {
  if (!validUtf8(bytes)) return undefined
  let output = ''
  for (let index = 0; index < bytes.length; index += 1) {
    const first = bytes[index] ?? 0
    if (first <= 0x7f) output += String.fromCharCode(first)
    else if (first <= 0xdf) {
      output += String.fromCharCode(((first & 31) << 6) | ((bytes[index + 1] ?? 0) & 63))
      index += 1
    } else if (first <= 0xef) {
      output += String.fromCharCode(
        ((first & 15) << 12) |
          (((bytes[index + 1] ?? 0) & 63) << 6) |
          ((bytes[index + 2] ?? 0) & 63),
      )
      index += 2
    } else {
      const codePoint =
        ((first & 7) << 18) |
        (((bytes[index + 1] ?? 0) & 63) << 12) |
        (((bytes[index + 2] ?? 0) & 63) << 6) |
        ((bytes[index + 3] ?? 0) & 63)
      output += String.fromCharCode(
        0xd800 | ((codePoint - 0x10000) >>> 10),
        0xdc00 | ((codePoint - 0x10000) & 1023),
      )
      index += 3
    }
  }
  return output
}

const text = (value: string, limit: number): Result<Uint8Array> => {
  if (value.length === 0) return fail('invalid-field')
  const bytes = encodeUtf8(value)
  if (!bytes) return fail('invalid-field')
  return bytes.length <= limit ? ok(bytes) : fail('limit-exceeded')
}
const encodedText = (value: string, limit: number): Result<Uint8Array> => {
  const result = text(value, limit)
  return result.ok ? ok(join([u16(result.value.length), result.value])) : result
}

const validUtf8 = (bytes: Uint8Array): boolean => {
  for (let index = 0; index < bytes.length; index += 1) {
    const first = bytes[index] ?? 0
    if (first <= 0x7f) continue
    const second = bytes[index + 1] ?? 0
    const third = bytes[index + 2] ?? 0
    const fourth = bytes[index + 3] ?? 0
    const continuation = (value: number): boolean => value >= 0x80 && value <= 0xbf
    if (first >= 0xc2 && first <= 0xdf && continuation(second)) {
      index += 1
      continue
    }
    if (first === 0xe0 && second >= 0xa0 && second <= 0xbf && continuation(third)) {
      index += 2
      continue
    }
    if (
      ((first >= 0xe1 && first <= 0xec) || first === 0xee || first === 0xef) &&
      continuation(second) &&
      continuation(third)
    ) {
      index += 2
      continue
    }
    if (first === 0xed && second >= 0x80 && second <= 0x9f && continuation(third)) {
      index += 2
      continue
    }
    if (
      first === 0xf0 &&
      second >= 0x90 &&
      second <= 0xbf &&
      continuation(third) &&
      continuation(fourth)
    ) {
      index += 3
      continue
    }
    if (
      first >= 0xf1 &&
      first <= 0xf3 &&
      continuation(second) &&
      continuation(third) &&
      continuation(fourth)
    ) {
      index += 3
      continue
    }
    if (
      first === 0xf4 &&
      second >= 0x80 &&
      second <= 0x8f &&
      continuation(third) &&
      continuation(fourth)
    ) {
      index += 3
      continue
    }
    return false
  }
  return true
}

const sha256 = (input: Uint8Array): Uint8Array => {
  const length = Math.ceil((input.length + 9) / 64) * 64
  const bytes = new Uint8Array(length)
  bytes.set(input)
  bytes[input.length] = 128
  let bits = input.length * 8
  for (let i = 0; i < 8; i += 1) {
    bytes[length - 1 - i] = bits & 255
    bits = Math.floor(bits / 256)
  }
  const h = Uint32Array.of(
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19,
  )
  const k = Uint32Array.of(
    0x428a2f98,
    0x71374491,
    0xb5c0fbcf,
    0xe9b5dba5,
    0x3956c25b,
    0x59f111f1,
    0x923f82a4,
    0xab1c5ed5,
    0xd807aa98,
    0x12835b01,
    0x243185be,
    0x550c7dc3,
    0x72be5d74,
    0x80deb1fe,
    0x9bdc06a7,
    0xc19bf174,
    0xe49b69c1,
    0xefbe4786,
    0x0fc19dc6,
    0x240ca1cc,
    0x2de92c6f,
    0x4a7484aa,
    0x5cb0a9dc,
    0x76f988da,
    0x983e5152,
    0xa831c66d,
    0xb00327c8,
    0xbf597fc7,
    0xc6e00bf3,
    0xd5a79147,
    0x06ca6351,
    0x14292967,
    0x27b70a85,
    0x2e1b2138,
    0x4d2c6dfc,
    0x53380d13,
    0x650a7354,
    0x766a0abb,
    0x81c2c92e,
    0x92722c85,
    0xa2bfe8a1,
    0xa81a664b,
    0xc24b8b70,
    0xc76c51a3,
    0xd192e819,
    0xd6990624,
    0xf40e3585,
    0x106aa070,
    0x19a4c116,
    0x1e376c08,
    0x2748774c,
    0x34b0bcb5,
    0x391c0cb3,
    0x4ed8aa4a,
    0x5b9cca4f,
    0x682e6ff3,
    0x748f82ee,
    0x78a5636f,
    0x84c87814,
    0x8cc70208,
    0x90befffa,
    0xa4506ceb,
    0xbef9a3f7,
    0xc67178f2,
  )
  const w = new Uint32Array(64)
  const r = (x: number, n: number): number => (x >>> n) | (x << (32 - n))
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const p = offset + 4 * i
      w[i] =
        ((bytes[p] ?? 0) << 24) |
        ((bytes[p + 1] ?? 0) << 16) |
        ((bytes[p + 2] ?? 0) << 8) |
        (bytes[p + 3] ?? 0)
    }
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15] ?? 0
      const b = w[i - 2] ?? 0
      w[i] =
        ((r(a, 7) ^ r(a, 18) ^ (a >>> 3)) +
          (w[i - 16] ?? 0) +
          (r(b, 17) ^ r(b, 19) ^ (b >>> 10)) +
          (w[i - 7] ?? 0)) >>>
        0
    }
    let a = h[0] ?? 0
    let b = h[1] ?? 0
    let c = h[2] ?? 0
    let d = h[3] ?? 0
    let e = h[4] ?? 0
    let f = h[5] ?? 0
    let g = h[6] ?? 0
    let hh = h[7] ?? 0
    for (let i = 0; i < 64; i += 1) {
      const t1 =
        (hh +
          (r(e, 6) ^ r(e, 11) ^ r(e, 25)) +
          ((e & f) ^ (~e & g)) +
          (k[i] ?? 0) +
          (w[i] ?? 0)) >>>
        0
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h[0] = ((h[0] ?? 0) + a) >>> 0
    h[1] = ((h[1] ?? 0) + b) >>> 0
    h[2] = ((h[2] ?? 0) + c) >>> 0
    h[3] = ((h[3] ?? 0) + d) >>> 0
    h[4] = ((h[4] ?? 0) + e) >>> 0
    h[5] = ((h[5] ?? 0) + f) >>> 0
    h[6] = ((h[6] ?? 0) + g) >>> 0
    h[7] = ((h[7] ?? 0) + hh) >>> 0
  }
  const output = new Uint8Array(32)
  for (let i = 0; i < 8; i += 1) output.set(u32(h[i] ?? 0), i * 4)
  return output
}

export const encodeEnvelope = (input: EnvelopeInput): Result<Uint8Array> => {
  if (
    !protocolKinds.includes(input.kind) ||
    !Number.isSafeInteger(input.sentAt) ||
    !Number.isSafeInteger(input.expiresAt) ||
    !Number.isSafeInteger(input.nonce) ||
    input.sentAt < 0 ||
    input.expiresAt < input.sentAt ||
    input.expiresAt - input.sentAt > 300 ||
    input.nonce < 0
  )
    return fail('invalid-field')
  if (
    input.payload.length > frameLimit ||
    (input.evidence?.length ?? 0) > evidenceLimit ||
    input.signature.length === 0 ||
    input.signature.length > 1_024
  )
    return fail('limit-exceeded')
  const fields = [
    encodedText(input.messageId, identifierLimit),
    encodedText(input.senderIdentity, identifierLimit),
    encodedText(input.audience, identifierLimit),
    encodedText(input.keyRevision, identifierLimit),
    encodedText(input.correlationId, identifierLimit),
  ]
  const failed = fields.find((fieldResult) => !fieldResult.ok)
  if (failed) return failed
  const values = fields.map((fieldResult) =>
    fieldResult.ok ? fieldResult.value : new Uint8Array(),
  )
  const evidence = input.evidence ?? new Uint8Array()
  const unsigned = join([
    magic,
    Uint8Array.of(1, protocolKinds.indexOf(input.kind), input.compression),
    values[0] ?? new Uint8Array(),
    values[1] ?? new Uint8Array(),
    values[2] ?? new Uint8Array(),
    values[3] ?? new Uint8Array(),
    u64(input.sentAt),
    u64(input.expiresAt),
    values[4] ?? new Uint8Array(),
    u64(input.nonce),
    u32(input.payload.length),
    input.payload,
    u16(evidence.length),
    evidence,
    sha256(input.payload),
  ])
  const frame = join([unsigned, u16(input.signature.length), input.signature])
  return frame.length <= frameLimit ? ok(frame) : fail('limit-exceeded')
}

const equal = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index])

export const decodeEnvelope = (
  frame: Uint8Array,
  context: DecodeContext,
): Result<ProtocolEnvelope> => {
  if (frame.length > frameLimit || frame.length < magic.length + 2)
    return fail(frame.length > frameLimit ? 'limit-exceeded' : 'malformed-encoding')
  let offset = 0
  const take = (length: number): Uint8Array | undefined => {
    if (length < 0 || offset + length > frame.length) return undefined
    const value = frame.slice(offset, offset + length)
    offset += length
    return value
  }
  const number = (length: number): number | undefined => {
    const value = take(length)
    return value?.reduce((total, byte) => total * 256 + byte, 0)
  }
  const string = (limit: number): string | undefined => {
    const length = number(2)
    if (length === undefined || length > limit) return undefined
    const value = take(length)
    if (!value) return undefined
    const decoded = decodeUtf8(value)
    return !decoded ? undefined : decoded
  }
  const header = take(3)
  if (!header || !equal(header, magic)) return fail('malformed-encoding')
  const version = number(1)
  if (version === undefined) return fail('malformed-encoding')
  if (version !== 1) return fail('unknown-version')
  const kindNumber = number(1)
  if (kindNumber === undefined) return fail('malformed-encoding')
  const kind = protocolKinds[kindNumber]
  if (!kind) return fail('unknown-kind')
  const compression = number(1)
  if (compression !== 0) return fail('invalid-field')
  const messageId = string(identifierLimit)
  const senderIdentity = string(identifierLimit)
  const audience = string(identifierLimit)
  const keyRevision = string(identifierLimit)
  const sentAt = number(8)
  const expiresAt = number(8)
  const correlationId = string(identifierLimit)
  const nonce = number(8)
  const payloadLength = number(4)
  if (
    !messageId ||
    !senderIdentity ||
    !audience ||
    !keyRevision ||
    sentAt === undefined ||
    expiresAt === undefined ||
    !correlationId ||
    nonce === undefined ||
    payloadLength === undefined ||
    !Number.isSafeInteger(sentAt) ||
    !Number.isSafeInteger(expiresAt) ||
    !Number.isSafeInteger(nonce)
  )
    return fail('malformed-encoding')
  if (payloadLength > frameLimit) return fail('limit-exceeded')
  const payload = take(payloadLength)
  const evidenceLength = number(2)
  if (!payload || evidenceLength === undefined) return fail('malformed-encoding')
  if (evidenceLength > evidenceLimit) return fail('limit-exceeded')
  const evidence = take(evidenceLength)
  const payloadHash = take(32)
  const unsignedEnd = offset
  const signatureLength = number(2)
  if (
    !evidence ||
    !payloadHash ||
    signatureLength === undefined ||
    signatureLength === 0 ||
    signatureLength > 1_024
  )
    return fail('malformed-encoding')
  const signature = take(signatureLength)
  if (!signature || offset !== frame.length) return fail('malformed-encoding')
  if (!equal(payloadHash, sha256(payload))) return fail('invalid-payload-hash')
  if (expiresAt < sentAt || expiresAt - sentAt > 300) return fail('invalid-field')
  if (sentAt > context.now + 30) return fail('future-clock')
  if (expiresAt < context.now) return fail('expired')
  const envelope: ProtocolEnvelope = {
    version: 1,
    kind,
    compression: 0,
    messageId,
    senderIdentity,
    audience,
    keyRevision,
    sentAt,
    expiresAt,
    correlationId,
    nonce,
    payload,
    ...(evidence.length > 0 ? { evidence } : {}),
    payloadHash,
    signature,
  }
  const verified = context.verify(envelope, frame.slice(0, unsignedEnd))
  return verified.ok ? ok(envelope) : verified
}

export type ReplayRecord = Readonly<{ canonicalBytes: Uint8Array; result: string }>
export type ReplayStore = Readonly<{
  find: (messageId: string) => ReplayRecord | undefined
  highWater: (senderIdentity: string, keyRevision: string) => number | undefined
  record: (
    input: Readonly<{
      messageId: string
      canonicalBytes: Uint8Array
      senderIdentity: string
      keyRevision: string
      nonce: number
      result: string
    }>,
  ) => void
}>
export type Admission = Readonly<{ outcome: 'accepted' | 'duplicate'; result: string }>
export type ReplayCandidate = Pick<
  ProtocolEnvelope,
  'messageId' | 'senderIdentity' | 'keyRevision' | 'nonce'
>

export const admitEnvelope = (
  envelope: ReplayCandidate,
  canonicalBytes: Uint8Array,
  result: string,
  store: ReplayStore,
): Result<Admission> => {
  const previous = store.find(envelope.messageId)
  if (previous)
    return equal(previous.canonicalBytes, canonicalBytes)
      ? ok({ outcome: 'duplicate', result: previous.result })
      : fail('id-conflict')
  const highWater = store.highWater(envelope.senderIdentity, envelope.keyRevision)
  if (highWater !== undefined && envelope.nonce <= highWater) return fail('replayed')
  store.record({
    messageId: envelope.messageId,
    canonicalBytes: canonicalBytes.slice(),
    senderIdentity: envelope.senderIdentity,
    keyRevision: envelope.keyRevision,
    nonce: envelope.nonce,
    result,
  })
  return ok({ outcome: 'accepted', result })
}

export const createInMemoryReplayStore = (): ReplayStore => {
  const records = new Map<string, ReplayRecord>()
  const nonces = new Map<string, number>()
  const key = (senderIdentity: string, keyRevision: string): string =>
    `${senderIdentity}\u0000${keyRevision}`
  return {
    find: (messageId) => records.get(messageId),
    highWater: (senderIdentity, keyRevision) => nonces.get(key(senderIdentity, keyRevision)),
    record: ({ messageId, canonicalBytes, senderIdentity, keyRevision, nonce, result }) => {
      records.set(messageId, { canonicalBytes, result })
      nonces.set(key(senderIdentity, keyRevision), nonce)
    },
  }
}

export const protocolFixture: EnvelopeInput = {
  version: 1,
  kind: 'job.request',
  compression: 0,
  messageId: 'message-1',
  senderIdentity: 'sender-1',
  audience: 'recipient-1',
  keyRevision: 'key-1',
  sentAt: 1_000,
  expiresAt: 1_300,
  correlationId: 'correlation-1',
  nonce: 1,
  payload: Uint8Array.of(1, 2, 3),
  signature: Uint8Array.of(4),
}

export const encodeProtocolFixture = (): Result<Uint8Array> => encodeEnvelope(protocolFixture)

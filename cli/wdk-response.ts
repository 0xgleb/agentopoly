import * as Effect from 'effect/Effect'

export type SourceAddressResult = Readonly<{
  readonly address: string
  readonly index: number
  readonly network: string
}>

export type WdkResponseFailure = Readonly<{ readonly _tag: 'malformed-response' }>

export type TransferExpectation = Readonly<{
  readonly atomicAmount: string
  readonly destination: string
  readonly network: string
}>

const malformed: WdkResponseFailure = { _tag: 'malformed-response' }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const decodeTextContent = (
  input: unknown,
): Effect.Effect<Record<string, unknown>, WdkResponseFailure> => {
  const content = isRecord(input) ? input['content'] : undefined
  if (!Array.isArray(content) || content.length !== 1) return Effect.fail(malformed)
  const item: unknown = content[0]
  if (!isRecord(item) || item['type'] !== 'text' || typeof item['text'] !== 'string') {
    return Effect.fail(malformed)
  }
  const text = item['text']
  return Effect.flatMap(
    Effect.try({ try: (): unknown => JSON.parse(text), catch: () => malformed }),
    (parsed) => (isRecord(parsed) ? Effect.succeed(parsed) : Effect.fail(malformed)),
  )
}

const matchesTransfer = (value: Record<string, unknown>, expected: TransferExpectation): boolean =>
  value['network'] === expected.network &&
  value['to'] === expected.destination &&
  value['amount'] === expected.atomicAmount

export const decodeSourceAddressResult = (
  input: unknown,
  expected: Readonly<{ readonly index: number; readonly network: string }>,
): Effect.Effect<SourceAddressResult, WdkResponseFailure> =>
  Effect.flatMap(decodeTextContent(input), (parsed) =>
    typeof parsed['address'] === 'string' &&
    parsed['address'].trim().length > 0 &&
    parsed['network'] === expected.network &&
    parsed['index'] === expected.index &&
    Number.isSafeInteger(parsed['index']) &&
    parsed['index'] >= 0
      ? Effect.succeed({
          address: parsed['address'],
          index: parsed['index'],
          network: parsed['network'],
        })
      : Effect.fail(malformed),
  )

export const decodePreviewResult = (
  input: unknown,
  expected: TransferExpectation,
): Effect.Effect<Readonly<{ readonly estimatedNativeFee: string }>, WdkResponseFailure> =>
  Effect.flatMap(decodeTextContent(input), (parsed) =>
    parsed['preview'] === true &&
    matchesTransfer(parsed, expected) &&
    typeof parsed['estimatedFee'] === 'string'
      ? Effect.succeed({ estimatedNativeFee: parsed['estimatedFee'] })
      : Effect.fail(malformed),
  )

export const decodeBroadcastResult = (
  input: unknown,
  expected: TransferExpectation,
): Effect.Effect<Readonly<{ readonly transactionHash: string }>, WdkResponseFailure> =>
  Effect.flatMap(decodeTextContent(input), (parsed) =>
    parsed['success'] === true &&
    matchesTransfer(parsed, expected) &&
    typeof parsed['txHash'] === 'string' &&
    /^[a-f0-9]{64}$/.test(parsed['txHash'])
      ? Effect.succeed({ transactionHash: parsed['txHash'] })
      : Effect.fail(malformed),
  )

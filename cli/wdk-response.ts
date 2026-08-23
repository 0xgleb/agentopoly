import * as Effect from 'effect/Effect'

export type SourceAddressResult = Readonly<{
  readonly address: string
  readonly index: number
  readonly network: string
}>

export type WdkResponseFailure = Readonly<{ readonly _tag: 'malformed-response' }>

const malformed: WdkResponseFailure = { _tag: 'malformed-response' }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const decodeSourceAddressResult = (
  input: unknown,
): Effect.Effect<SourceAddressResult, WdkResponseFailure> => {
  const content = isRecord(input) ? input['content'] : undefined
  if (!Array.isArray(content) || content.length !== 1) {
    return Effect.fail(malformed)
  }
  const item: unknown = content[0]
  if (!isRecord(item) || item['type'] !== 'text' || typeof item['text'] !== 'string') {
    return Effect.fail(malformed)
  }
  const text = item['text']
  return Effect.flatMap(
    Effect.try({ try: (): unknown => JSON.parse(text), catch: () => malformed }),
    (parsed) =>
      isRecord(parsed) &&
      typeof parsed['address'] === 'string' &&
      parsed['address'].trim().length > 0 &&
      typeof parsed['network'] === 'string' &&
      parsed['network'].trim().length > 0 &&
      typeof parsed['index'] === 'number' &&
      Number.isSafeInteger(parsed['index']) &&
      parsed['index'] >= 0
        ? Effect.succeed({
            address: parsed['address'],
            index: parsed['index'],
            network: parsed['network'],
          })
        : Effect.fail(malformed),
  )
}

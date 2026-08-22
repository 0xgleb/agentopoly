import * as Effect from 'effect/Effect'
import { decodeDashboardProjection } from './projection.ts'
import { renderDashboard } from './render.ts'

const maximumProjectionBytes = 128 * 1024

const unavailable = (reason: string): string =>
  `<main class="dashboard dashboard--unavailable"><p class="eyebrow">LOCAL OPERATOR DASHBOARD</p><h1>Awaiting a typed local projection</h1><p>${reason}</p></main>`

const readBoundedResponse = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  buffer: Uint8Array,
  byteLength: number,
): Promise<string | undefined> => {
  const next = await reader.read()
  if (next.done) return new TextDecoder().decode(buffer.subarray(0, byteLength))

  const nextByteLength = byteLength + next.value.byteLength
  if (nextByteLength > maximumProjectionBytes) {
    await reader.cancel()
    return undefined
  }

  buffer.set(next.value, byteLength)
  return readBoundedResponse(reader, buffer, nextByteLength)
}

const responseText = async (response: Response): Promise<string | undefined> => {
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null && Number(contentLength) > maximumProjectionBytes) return undefined
  if (response.body === null) return undefined

  return readBoundedResponse(response.body.getReader(), new Uint8Array(maximumProjectionBytes), 0)
}

const load = Effect.tryPromise({
  try: async (): Promise<string | undefined> => {
    const response = await fetch('/api/dashboard/projection', { credentials: 'same-origin' })
    return response.ok ? responseText(response) : undefined
  },
  catch: () => undefined,
}).pipe(
  Effect.flatMap((text) => {
    if (text === undefined)
      return Effect.succeed(unavailable('The local participant has not published a projection.'))
    return Effect.try({ try: (): unknown => JSON.parse(text), catch: () => undefined }).pipe(
      Effect.flatMap((value) =>
        value === undefined
          ? Effect.succeed(unavailable('The local projection was refused.'))
          : decodeDashboardProjection(value).pipe(
              Effect.map(renderDashboard),
              Effect.catchAll(() =>
                Effect.succeed(unavailable('The local projection was refused.')),
              ),
            ),
      ),
    )
  }),
)
const root = document.querySelector<HTMLElement>('#dashboard')
if (root !== null)
  void Effect.runPromise(load)
    .then((view) => {
      root.innerHTML = view
    })
    .catch(() => {
      root.innerHTML = unavailable('The local projection boundary is unavailable.')
    })

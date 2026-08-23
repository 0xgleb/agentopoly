import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import { defineConfig, type Plugin } from 'vite'
import solid from 'vite-plugin-solid'

import { projectEventLog } from './projection.ts'

type EventLogReadFailure = Readonly<{
  readonly _tag: 'event-log-unavailable' | 'missing-event-log'
}>

const browserRoot = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = dirname(browserRoot)
const eventLogPath = join(repositoryRoot, '.tmp', 'agentopoly-events.jsonl')

const sendJson = (response: ServerResponse, status: number, value: unknown): void => {
  response.statusCode = status
  response.setHeader('cache-control', 'no-store')
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(value))
}

const isMissingEventLog = (cause: unknown): boolean =>
  typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === 'ENOENT'

const readEventLog = (): Effect.Effect<string, EventLogReadFailure> =>
  Effect.tryPromise({
    try: () => readFile(eventLogPath, 'utf8'),
    catch: (cause: unknown) => ({
      _tag: isMissingEventLog(cause) ? 'missing-event-log' : 'event-log-unavailable',
    }),
  })

const handleProjectionRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> => {
  if (request.method !== 'GET') {
    response.setHeader('allow', 'GET')
    sendJson(response, 405, { _tag: 'refused', reason: 'method-not-allowed' })
    return
  }

  const result = await Effect.runPromise(Effect.either(readEventLog()))
  if (Either.isLeft(result)) {
    if (result.left._tag === 'missing-event-log') {
      sendJson(response, 200, projectEventLog('', new Date()))
      return
    }
    sendJson(response, 503, { _tag: 'refused', reason: 'projection-unavailable' })
    return
  }

  const projection = projectEventLog(result.right, new Date())
  sendJson(response, projection._tag === 'projection' ? 200 : 422, projection)
}

const projectionApi = (): Plugin => ({
  configureServer(server) {
    server.middlewares.use('/api/projection', (request, response) => {
      void handleProjectionRequest(request, response)
    })
  },
  name: 'agentopoly-projection-api',
})

export default defineConfig({
  plugins: [solid(), projectionApi()],
  root: browserRoot,
  server: {
    host: '127.0.0.1',
  },
})

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

import * as Effect from 'effect/Effect'

import { decodeSidecarCommand } from './wdk-sidecar-contract.ts'
import { decodeSourceAddressResult } from './wdk-response.ts'

const moduleRoot = fileURLToPath(new URL('../', import.meta.url))
const mcpEntrypoint = new URL('../node_modules/@tetherto/wdk-cli/bin/wdk-mcp.mjs', import.meta.url)
const requestTimeoutMs = 30_000
const maximumCommandBytes = 65_536

const write = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)

const request = (child, id, method, params) =>
  new Promise((resolve, reject) => {
    let buffer = ''
    const timeout = setTimeout(() => {
      reject(new Error('WDK MCP request timed out'))
    }, requestTimeoutMs)
    const complete = (value) => {
      clearTimeout(timeout)
      resolve(value)
    }
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      while (true) {
        const newline = buffer.indexOf('\n')
        if (newline < 0) return
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        let response
        try {
          response = JSON.parse(line)
        } catch {
          continue
        }
        if (response?.id !== id) continue
        if (response.error !== undefined) {
          clearTimeout(timeout)
          reject(new Error('WDK MCP rejected the fixed request'))
          return
        }
        complete(response.result)
        return
      }
    })
    child.once('error', reject)
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })

const callWdkMcp = async (command) => {
  const child = spawn(process.execPath, [fileURLToPath(mcpEntrypoint)], {
    cwd: moduleRoot,
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  try {
    await request(child, 1, 'initialize', {
      capabilities: {},
      clientInfo: { name: 'agentopoly-wdk-sidecar', version: '1' },
      protocolVersion: '2025-11-25',
    })
    const result = await request(
      child,
      2,
      'tools/call',
      command.type === 'get-source-address'
        ? {
            arguments: {
              index: command.sourceAccountIndex,
              network: command.network,
              wallet: command.sourceWallet,
            },
            name: 'get_address',
          }
        : {
            arguments: {
              amount: command.atomicAmount,
              baseUnits: true,
              dryRun: command.type === 'preview-payment',
              index: command.sourceAccountIndex,
              network: command.network,
              to: command.destination,
              token: command.token,
              wallet: command.sourceWallet,
            },
            name: 'send_token',
          },
    )
    if (command.type === 'get-source-address') {
      return {
        result: await Effect.runPromise(decodeSourceAddressResult(result)),
        type: command.type,
      }
    }
    return { result, type: command.type }
  } finally {
    child.kill()
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of lines) {
  if (Buffer.byteLength(line, 'utf8') > maximumCommandBytes) {
    write({ error: 'command-too-large', ok: false })
    continue
  }
  let input
  try {
    input = JSON.parse(line)
  } catch {
    write({ error: 'invalid-json', ok: false })
    continue
  }
  const decoded = await Effect.runPromise(Effect.either(decodeSidecarCommand(input)))
  if (decoded._tag === 'Left') {
    write({ error: decoded.left._tag, ok: false })
    continue
  }
  try {
    write({ ok: true, ...(await callWdkMcp(decoded.right)) })
  } catch {
    write({ error: 'wdk-unavailable-or-rejected', ok: false })
  }
}

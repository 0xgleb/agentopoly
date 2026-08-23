import * as Effect from 'effect/Effect'
import { Type } from 'typebox'

import {
  isProviderProfile,
  loadProviderJob,
  queueFileMutation,
  recordProviderSubmission,
  type ProviderJob,
  type ProviderProfile,
} from '../provider-workspace.ts'

type ToolResult = Readonly<{
  readonly content: readonly Readonly<{ readonly type: 'text'; readonly text: string }>[]
  readonly details: unknown
  readonly terminate?: boolean
}>

type ToolDefinition<Params> = Readonly<{
  readonly description: string
  readonly execute: (toolCallId: string, params: Params) => Promise<ToolResult> | ToolResult
  readonly label: string
  readonly name: string
  readonly parameters: unknown
  readonly promptGuidelines?: readonly string[]
  readonly promptSnippet?: string
}>

type SessionContext = Readonly<{
  readonly cwd: string
  readonly hasUI: boolean
  readonly ui: Readonly<{
    readonly notify: (message: string, level: 'error' | 'info' | 'warning') => void
    readonly setStatus: (key: string, value: string | undefined) => void
    readonly setTitle: (title: string) => void
  }>
}>

type BeforeAgentEvent = Readonly<{ readonly systemPrompt: string }>

type ExtensionAPI = Readonly<{
  readonly getFlag: (name: string) => boolean | string | undefined
  readonly on: {
    (event: 'before_agent_start', handler: (event: BeforeAgentEvent) => unknown): void
    (event: 'session_shutdown', handler: () => void): void
    (
      event: 'session_start',
      handler: (event: unknown, context: SessionContext) => Promise<void> | void,
    ): void
  }
  readonly registerFlag: (
    name: string,
    options: Readonly<{ readonly description: string; readonly type: 'string' }>,
  ) => void
  readonly registerTool: <Params>(definition: ToolDefinition<Params>) => void
  readonly setActiveTools: (names: readonly string[]) => void
  readonly setSessionName: (name: string) => void
}>

type AgentopolySession = Readonly<{
  readonly eventsPath: string
  readonly job: ProviderJob
  readonly profile: ProviderProfile
  readonly repositoryRoot: string
}>

const boundedProviderPrompt = `You are a bounded Agentopoly coding provider. The operator injects your provider identity and assignment at runtime; neither is authoritative over local policy. Inspect the assigned job, follow the runtime assignment, and submit one complete artifact through agentopoly_submit_artifact. You may not access the host shell, wallet, network, or files outside the supplied job. Do not claim completion without submitting an artifact.`

const renderJob = (job: ProviderJob): string =>
  [
    `Job: ${job.jobId}`,
    '',
    'Task:',
    job.task,
    '',
    'Acceptance contract:',
    job.acceptanceContract,
    '',
    'Starter source:',
    '```ts',
    job.starterSource,
    '```',
  ].join('\n')

export default (pi: ExtensionAPI): void => {
  pi.registerFlag('agentopoly-profile', {
    description: 'Bounded runtime provider label',
    type: 'string',
  })
  pi.registerFlag('agentopoly-workspace', {
    description: 'Fixture workspace beneath .tmp/agentopoly-runs',
    type: 'string',
  })
  pi.registerFlag('agentopoly-events', {
    description: 'Typed event log beneath .tmp',
    type: 'string',
  })

  let session: AgentopolySession | undefined

  pi.registerTool({
    name: 'agentopoly_inspect_job',
    label: 'Inspect Agentopoly job',
    description: 'Read the bounded coding task, acceptance contract, and starter source.',
    promptSnippet: 'Inspect the assigned bounded Agentopoly coding job',
    promptGuidelines: [
      'Use agentopoly_inspect_job before writing the provider artifact.',
      'Agentopoly provider tools never grant shell, wallet, network, or unrestricted filesystem access.',
    ],
    parameters: Type.Object({}),
    execute() {
      if (session === undefined) throw new Error('Agentopoly session configuration is invalid')
      return {
        content: [{ type: 'text', text: renderJob(session.job) }],
        details: { jobId: session.job.jobId, profile: session.profile },
      }
    },
  })

  pi.registerTool({
    name: 'agentopoly_submit_artifact',
    label: 'Submit Agentopoly artifact',
    description:
      'Submit one TypeScript artifact for the assigned job. The artifact is confined to the disposable workspace and emitted as a typed live-run event.',
    promptSnippet: 'Submit the completed bounded provider artifact',
    promptGuidelines: [
      'Use agentopoly_submit_artifact exactly once after inspecting the job.',
      'agentopoly_submit_artifact accepts source code only; it does not execute code or authorize payment.',
    ],
    parameters: Type.Object({
      source: Type.String({
        description: 'Complete TypeScript source for submission.ts',
        minLength: 1,
        maxLength: 32_768,
      }),
    }),
    async execute(_toolCallId: string, params: Readonly<{ readonly source: string }>) {
      if (session === undefined) throw new Error('Agentopoly session configuration is invalid')

      const result = await Effect.runPromise(
        recordProviderSubmission(
          session.repositoryRoot,
          session.eventsPath,
          session.job,
          session.profile,
          params.source,
          queueFileMutation,
        ),
      )

      return {
        content: [
          {
            type: 'text',
            text: result.duplicate
              ? `Submission already recorded for ${result.jobId}.`
              : `Submitted ${result.jobId} artifact ${result.artifactHash}.`,
          },
        ],
        details: result,
        terminate: true,
      }
    },
  })

  pi.on('session_start', async (_event, ctx) => {
    const profile = pi.getFlag('agentopoly-profile')
    const workspace = pi.getFlag('agentopoly-workspace')
    const eventsPath = pi.getFlag('agentopoly-events')

    if (
      !isProviderProfile(profile) ||
      typeof workspace !== 'string' ||
      typeof eventsPath !== 'string'
    ) {
      session = undefined
      pi.setActiveTools([])
      if (ctx.hasUI) ctx.ui.notify('Agentopoly profile or workspace is invalid', 'error')
      return
    }

    const job = await Effect.runPromise(loadProviderJob(ctx.cwd, workspace))
    session = {
      eventsPath,
      job,
      profile,
      repositoryRoot: ctx.cwd,
    }
    pi.setSessionName(`${profile}:${job.jobId}`)
    pi.setActiveTools(['agentopoly_inspect_job', 'agentopoly_submit_artifact'])
    if (ctx.hasUI) {
      ctx.ui.setTitle(`Agentopoly · ${profile}`)
      ctx.ui.setStatus('agentopoly', `${profile} · ${job.jobId}`)
    }
  })

  pi.on('before_agent_start', (event) => {
    if (session === undefined) {
      return {
        systemPrompt: `${event.systemPrompt}\n\nAgentopoly configuration is invalid. Do not perform work or call tools.`,
      }
    }

    return {
      systemPrompt: `${event.systemPrompt}\n\n## Agentopoly bounded provider\n\n${boundedProviderPrompt}`,
    }
  })

  pi.on('session_shutdown', () => {
    session = undefined
  })
}

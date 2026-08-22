import * as Effect from 'effect/Effect'

export type DashboardCommand = Readonly<{ readonly type: 'request-refresh' }>

export type UnauthorizedDashboardCommand = Readonly<{
  readonly _tag: 'unauthorized-dashboard-command'
  readonly reason: string
}>

export type UnsupportedDashboardCommand = Readonly<{
  readonly _tag: 'unsupported-dashboard-command'
  readonly reason: string
}>

export type DashboardCommandBoundary = Readonly<{
  readonly authorize: () => Effect.Effect<boolean>
  readonly dispatch: (command: DashboardCommand) => Effect.Effect<void>
}>

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isRefreshCommand = (command: unknown): command is DashboardCommand =>
  isRecord(command) && Object.keys(command).length === 1 && command['type'] === 'request-refresh'

export const submitLocalDashboardCommand =
  (
    boundary: DashboardCommandBoundary,
  ): ((
    command: unknown,
  ) => Effect.Effect<void, UnauthorizedDashboardCommand | UnsupportedDashboardCommand>) =>
  (command) => {
    if (!isRefreshCommand(command)) {
      return Effect.fail<UnauthorizedDashboardCommand | UnsupportedDashboardCommand>({
        _tag: 'unsupported-dashboard-command',
        reason: 'dashboard commands cannot authorize payment, transport, or execution',
      })
    }

    return Effect.gen(function* () {
      const authorized = yield* boundary.authorize()

      if (!authorized) {
        return yield* Effect.fail<UnauthorizedDashboardCommand | UnsupportedDashboardCommand>({
          _tag: 'unauthorized-dashboard-command',
          reason: 'local dashboard command is not authorized',
        })
      }

      yield* boundary.dispatch({ type: 'request-refresh' })
    })
  }

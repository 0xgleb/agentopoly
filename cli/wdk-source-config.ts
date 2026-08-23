import * as Effect from 'effect/Effect'

export type WdkSourceConfig = Readonly<{
  readonly sourceAccountIndex: number
  readonly sourceWallet: string
}>

export type WdkSourceConfigFailure = Readonly<{ readonly _tag: 'invalid-source-config' }>

const invalid: WdkSourceConfigFailure = { _tag: 'invalid-source-config' }

export const decodeWdkSourceConfig = (
  input: Readonly<{
    readonly sourceAccountIndex: string | undefined
    readonly sourceWallet: string | undefined
  }>,
): Effect.Effect<WdkSourceConfig, WdkSourceConfigFailure> => {
  const sourceAccountIndex = input.sourceAccountIndex
  const sourceWallet = input.sourceWallet
  if (
    sourceWallet === undefined ||
    sourceWallet.trim().length === 0 ||
    sourceWallet.length > 256 ||
    sourceAccountIndex === undefined ||
    !/^(0|[1-9][0-9]*)$/.test(sourceAccountIndex)
  ) {
    return Effect.fail(invalid)
  }
  const index = Number(sourceAccountIndex)
  return Number.isSafeInteger(index)
    ? Effect.succeed({ sourceAccountIndex: index, sourceWallet })
    : Effect.fail(invalid)
}

export const enforcesWdkSourceConfig = (
  config: WdkSourceConfig,
  command: Readonly<{ readonly sourceAccountIndex: number; readonly sourceWallet: string }>,
): boolean =>
  config.sourceAccountIndex === command.sourceAccountIndex &&
  config.sourceWallet === command.sourceWallet

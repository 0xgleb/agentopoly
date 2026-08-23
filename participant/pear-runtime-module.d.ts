declare module 'pear-runtime' {
  type PearRuntimeOptions = Readonly<{
    readonly dir: string
  }>

  type PearSidecar = Readonly<{
    readonly destroy: () => void
    readonly on: (event: 'data', listener: (data: Uint8Array) => void) => void
    readonly once: {
      (event: 'close', listener: () => void): void
      (event: 'exit', listener: (code: number, signal: string | null) => void): void
    }
    readonly stderr: Readonly<{
      readonly on: (event: 'data', listener: (data: Uint8Array) => void) => void
    }>
  }>

  class PearRuntime {
    static run(entrypoint: string, args?: readonly string[]): PearSidecar

    constructor(options: PearRuntimeOptions)

    readonly close: () => Promise<void>
    readonly ready: () => Promise<void>
    readonly run: (entrypoint: string) => PearSidecar
  }

  export default PearRuntime
}

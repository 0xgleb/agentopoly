declare module "pear-runtime" {
  type PearRuntimeOptions = Readonly<{
    readonly dir: string
  }>

  type PearSidecar = Readonly<{
    readonly destroy: () => void
    readonly on: (event: "data", listener: (data: Uint8Array) => void) => void
    readonly once: (event: "close", listener: () => void) => void
  }>

  class PearRuntime {
    constructor(options: PearRuntimeOptions)

    readonly close: () => Promise<void>
    readonly ready: () => Promise<void>
    readonly run: (entrypoint: string) => PearSidecar
  }

  export default PearRuntime
}

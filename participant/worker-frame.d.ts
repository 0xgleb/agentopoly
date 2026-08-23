export type WorkerFrameResult =
  | Readonly<{ readonly ok: true; readonly value: readonly Uint8Array[] }>
  | Readonly<{ readonly ok: false; readonly error: 'invalid-frame' }>

export const decodeHostAdvertisementFrames: (bytes: Uint8Array) => WorkerFrameResult
export const encodeNetworkFrame: (payload: Uint8Array) => Uint8Array
export const encodePeerFrame: (payload: Uint8Array) => Uint8Array

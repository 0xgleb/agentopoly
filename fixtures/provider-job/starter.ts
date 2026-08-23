export type HandleResult =
  | Readonly<{ readonly ok: true; readonly value: string }>
  | Readonly<{
      readonly ok: false
      readonly reason: 'empty' | 'invalid-character' | 'too-long'
    }>

export const normalizeMarketHandle = (input: string): HandleResult => {
  void input
  return { ok: false, reason: 'empty' }
}

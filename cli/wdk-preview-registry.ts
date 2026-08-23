import { createHash } from 'node:crypto'

export type PreviewBinding = Readonly<{
  readonly atomicAmount: string
  readonly destination: string
  readonly network: string
  readonly termsHash: string
  readonly verificationHash: string
}>

export type IssuedPreview = Readonly<{
  readonly estimatedNativeFee: string
  readonly previewExpiresAt: number
  readonly previewHash: string
}>

type StoredPreview = PreviewBinding & IssuedPreview

export type PreviewRegistry = Readonly<{
  readonly consume: (
    binding: PreviewBinding & Pick<IssuedPreview, 'previewExpiresAt' | 'previewHash'>,
    now: number,
  ) => boolean
  readonly record: (
    binding: PreviewBinding,
    estimatedNativeFee: string,
    previewExpiresAt: number,
  ) => IssuedPreview
}>

const hash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex')

export const createPreviewRegistry = (): PreviewRegistry => {
  const previews = new Map<string, StoredPreview>()
  return {
    consume: (binding, now) => {
      const preview = previews.get(binding.previewHash)
      if (
        preview === undefined ||
        preview.previewExpiresAt <= now ||
        preview.previewExpiresAt !== binding.previewExpiresAt ||
        preview.atomicAmount !== binding.atomicAmount ||
        preview.destination !== binding.destination ||
        preview.network !== binding.network ||
        preview.termsHash !== binding.termsHash ||
        preview.verificationHash !== binding.verificationHash
      ) {
        return false
      }
      previews.delete(binding.previewHash)
      return true
    },
    record: (binding, estimatedNativeFee, previewExpiresAt) => {
      const previewHash = hash({ ...binding, estimatedNativeFee, previewExpiresAt })
      previews.set(previewHash, { ...binding, estimatedNativeFee, previewExpiresAt, previewHash })
      return { estimatedNativeFee, previewExpiresAt, previewHash }
    },
  }
}

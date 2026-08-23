const maximumEvidenceBytes = 16_384
const truncation = '…[truncated]'

const utf8Length = (value: string): number => new TextEncoder().encode(value).byteLength

const credentialAssignment = /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|KEY)[A-Z0-9_]*)=\S+/g

export const redactBoundedVerifierEvidence = (input: string, workspace: string): string => {
  const redacted = input
    .replaceAll(workspace, '<workspace>')
    .replace(credentialAssignment, '$1=[redacted]')
  if (utf8Length(redacted) <= maximumEvidenceBytes) return redacted

  const allowance = maximumEvidenceBytes - utf8Length(truncation)
  let output = ''
  for (const character of redacted) {
    if (utf8Length(output) + utf8Length(character) > allowance) break
    output += character
  }
  return `${output}${truncation}`
}

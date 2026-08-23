#!/usr/bin/env nu

# Rehearses the recorded provider-to-browser path without wallet capability.
#
# Phase 1 starts a real Pi provider and emits only its bounded workspace identity.
# Before Phase 2, an operator must place the strict locally signed agreement witness
# at the fixed workspace-derived location beneath `.tmp/agentopoly-agreements/` and
# configure the reviewed public key and local WDK policy. This script never reads a
# private key, wallet seed, or passphrase. `finalize` remains refusal-only until
# broadcast integration exists.

const maximum_evidence_bytes = 4096

def fail [message: string] {
  error make { msg: $message }
}

def bounded [value: string] {
  if (($value | str length) <= $maximum_evidence_bytes) {
    $value
  } else {
    $value | str substring 0..<$maximum_evidence_bytes
  }
}

def valid_workspace [workspace: string] {
  $workspace =~ '^\.tmp/agentopoly-runs/[a-zA-Z0-9-]+$' and ($workspace | str length) <= 1024
}

def witness_path [workspace: string] {
  if not (valid_workspace $workspace) {
    fail 'workspace must identify one bounded Agentopoly provider run'
  }
  let digest_result = (do {
    ^bun -e "import { createHash } from 'node:crypto'; process.stdout.write(createHash('sha256').update(process.argv[1], 'utf8').digest('hex'))" $workspace
  } | complete)
  if $digest_result.exit_code != 0 {
    fail 'could not derive the fixed agreement witness location'
  }
  let digest = $digest_result.stdout | str trim
  if not ($digest =~ '^[a-f0-9]{64}$') {
    fail 'derived agreement witness location is invalid'
  }
  $".tmp/agentopoly-agreements/($digest).json"
}

def summary_path [workspace: string] {
  let witness = witness_path $workspace
  let digest = $witness | path basename | str replace '.json' ''
  $".tmp/recording-rehearsals/($digest).json"
}

def write_summary [path: string, value: record] {
  mkdir ($path | path dirname)
  $value | to json | save --force $path
}

def workspace_from_provider [output: string] {
  let matches = $output | lines | parse 'Workspace: {workspace}'
  if ($matches | is-empty) {
    fail 'provider did not return a bounded workspace identity'
  }
  let workspace = $matches | get workspace | last
  if not (valid_workspace $workspace) {
    fail 'provider returned an invalid workspace identity'
  }
  $workspace
}

# Runs the real bounded Pi provider. It never prints model output; it records only
# the bounded workspace identity needed for the second rehearsal phase.
def provider [profile: string, prompt: string] {
  if (($prompt | str length) == 0 or ($prompt | str length) > 4096) {
    fail 'provider prompt must contain 1 to 4096 characters'
  }
  let result = (do { ^bun run agentopoly provider $profile --print $prompt } | complete)
  if $result.exit_code != 0 {
    fail $"provider failed: (bounded $result.stderr)"
  }
  let workspace = workspace_from_provider $result.stdout
  let evidence = summary_path $workspace
  write_summary $evidence {
    phase: 'provider'
    providerExitCode: $result.exit_code
    workspace: $workspace
  }
  print $"Provider workspace: ($workspace)"
  print $"Bounded rehearsal evidence: ($evidence)"
}

# Verifies a real workspace, records the initial refusal, repeats finalize, and
# proves the second invocation did not append event-log records. The strict witness
# is read only from its fixed directory to obtain the canonical terms hash for
# verification; finalize itself performs signature and policy checks before any WDK
# boundary can be reached.
def settle [workspace: string] {
  let witness = witness_path $workspace
  let witness_value = (open $witness)
  let terms_hash = $witness_value.termsHash?
  if ($terms_hash == null or (($terms_hash | str length) != 64)) {
    fail 'fixed agreement witness must provide a 64-character canonical terms hash'
  }
  let evidence = summary_path $workspace
  let verify = (with-env { AGENTOPOLY_TERMS_HASH: $terms_hash } { do { ^bun run agentopoly verify $workspace } | complete })
  if $verify.exit_code != 0 {
    fail $"verification failed: (bounded $verify.stderr)"
  }
  let event_log = '.tmp/agentopoly-events.jsonl'
  let before = (open --raw $event_log | lines | length)
  let first = (do { ^bun run agentopoly finalize $workspace } | complete)
  let after_first = (open --raw $event_log | lines | length)
  let second = (do { ^bun run agentopoly finalize $workspace } | complete)
  let after_second = (open --raw $event_log | lines | length)
  if $first.exit_code != 0 or $second.exit_code != 0 {
    fail $"finalize failed: (bounded ($first.stderr + $second.stderr))"
  }
  if $after_first != $after_second {
    fail 'second finalize appended settlement evidence'
  }
  write_summary $evidence {
    afterFirstFinalizeEvents: $after_first
    afterSecondFinalizeEvents: $after_second
    beforeFinalizeEvents: $before
    browserProjectionCommand: 'bun run dev'
    finalizeFirstOutput: (bounded $first.stdout)
    finalizeSecondOutput: (bounded $second.stdout)
    providerOutputIncluded: false
    verificationOutput: (bounded $verify.stdout)
    wdkProcessStarted: false
    workspace: $workspace
  }
  print $"Second finalize appended no events: ($after_first == $after_second)"
  print $"Start the local browser projection with: bun run dev"
  print $"Bounded rehearsal evidence: ($evidence)"
}

def main [phase?: string, first?: string, second?: string] {
  match $phase {
    'provider' => {
      if $first == null or $second == null {
        fail 'usage: rehearse-recorded-demo.nu provider <profile> <prompt>'
      }
      provider $first $second
    }
    'settle' => {
      if $first == null or $second != null {
        fail 'usage: rehearse-recorded-demo.nu settle <workspace>'
      }
      settle $first
    }
    _ => { fail "usage: rehearse-recorded-demo.nu <provider|settle> ..." }
  }
}

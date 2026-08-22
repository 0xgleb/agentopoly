import type { DashboardJob, DashboardProjection } from './projection.ts'

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')

const paymentLabel = (job: DashboardJob): string =>
  job.payment === 'receipted'
    ? 'Payment receipt issued'
    : job.payment === 'withheld'
      ? 'Payment withheld'
      : 'Payment outcome undetermined'

const settlementLabel = (job: DashboardJob): string =>
  job.settlement === 'not-broadcast' ? 'Settlement not broadcast' : `Settlement ${job.settlement}`

const verificationLabel = (job: DashboardJob): string =>
  job.verification === 'passed'
    ? 'Verification passed'
    : job.verification === 'failed'
      ? 'Verification failed'
      : 'Verification not run'

const renderJob = (job: DashboardJob): string => `
  <article class="job job--${job.verification}">
    <p class="eyebrow">${escapeHtml(job.phase)} · ${escapeHtml(job.id)}</p>
    <h3>${escapeHtml(job.title)}</h3>
    <p>${escapeHtml(verificationLabel(job))}</p>
    <p>${escapeHtml(paymentLabel(job))}</p>
    <p>${escapeHtml(settlementLabel(job))}</p>
    <details><summary>Bound evidence</summary><p>References only; full evidence remains local.</p><code>${escapeHtml(job.evidenceReference)}</code><code>${escapeHtml(job.termsReference)}</code><code>${escapeHtml(job.artifactReference)}</code></details>
  </article>`

export const renderDashboard = (projection: DashboardProjection): string => `
  <main class="dashboard" data-freshness="${projection.freshness}">
    <header><p class="eyebrow">LOCAL EVIDENCE PROJECTION · revision ${escapeHtml(projection.revision)}</p><h1>Agentopoly economy</h1><p>${projection.freshness === 'stale' ? 'STALE PROJECTION — commands are unavailable' : 'Local projection reports fresh'}</p><p>Generated ${escapeHtml(projection.generatedAt)}</p></header>
    <section><h2>Independent agents</h2><div class="agents">${projection.agents.map((agent) => `<article class="agent agent--${agent.role}"><p class="eyebrow">${escapeHtml(agent.role)} · ${escapeHtml(agent.availability)}</p><h3>${escapeHtml(agent.label)}</h3><p>${escapeHtml(agent.selectionEvidence)}</p></article>`).join('')}</div></section>
    <section><h2>Economy timeline</h2><div class="jobs">${projection.jobs.map(renderJob).join('')}</div></section>
  </main>`

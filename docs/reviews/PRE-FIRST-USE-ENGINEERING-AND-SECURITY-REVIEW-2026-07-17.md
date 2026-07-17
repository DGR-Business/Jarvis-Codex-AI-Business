# Pre-First-Use Engineering And Security Review

Date: 2026-07-17
Status: verified for first use
Scope: runtime, database, approvals, finance, OpenAI execution, scheduler,
recovery, local security, dashboard, operational startup, documentation, and
repository clutter

## Executive Finding

The system had a sound commercial and technical direction but still carried
pilot history, oversized read surfaces, ambiguous execution states, process-only
credentials, and several boundaries that relied too heavily on convention. The
review converted those assumptions into explicit code, tests, recovery paths,
and ordinary-language operator views.

No paid OpenAI call, publishing action, customer contact, account action, legal
decision, or money movement was performed during this review.

## Critical Corrections

### Runtime Truth

- Added atomic task claims and attempt records so concurrent scheduler ticks
  cannot dispatch the same provider work twice.
- Added stale-lease recovery and blocked scheduler execution for provider,
  spend, and approval-bound tasks.
- Made rejection and requested changes stop dependent work.
- Classified provider outcomes as not dispatched, definitely failed, completed,
  or unknown; unknown dispatches require review and cannot auto-retry.
- Reused the same interrupted Agents SDK run across an approved tool resume.

### Approval And Cost Safety

- Bound paid work to an immutable descriptor covering venture, workflow, task,
  worker, provider, model, materialised input, tools, limits, deadline, trace
  policy, cost cap, and external effects.
- Made approvals single-use, expiring, and invalid after scope changes.
- Added exact one-use tool approval and replay rejection.
- Rejected unknown models and unknown tool prices before approval.
- Counted realised provider cost and unresolved reservations exactly once.
- Kept estimates separate from reconciled spend and retained ambiguous outcomes
  as unresolved exposure.

### Data And Evidence

- Added schema version 11, future-schema refusal, integrity checks, and one
  active-venture enforcement.
- Isolated test databases and artifacts from the operator runtime.
- Made generated deliverables deterministic and idempotent.
- Required an AUD conversion rate and evidence for foreign-currency Gumroad
  imports.
- Prevented unverified commercial data from changing finance or learning truth.
- Made reconciled accounting append-only.
- Added an allowlist at the final dynamic SQL metadata boundary.

### Local Security

- Added a signed, in-memory, HttpOnly, SameSite=Strict operator session.
- Required loopback Host validation, same-origin mutation requests, JSON, CSRF,
  and the same session for WebSocket connections.
- Removed unsigned email/action-token decision routes and generic live-action
  mutation paths.
- Restricted static files and PDF previews to approved roots.
- Added content security, frame, MIME, referrer, permissions, body-size, header,
  request, and keep-alive controls.
- Returned generic request IDs for unexpected server errors while keeping
  internal details in the local event log.
- Audited all dashboard HTML insertion paths; dynamic provider and database text
  is escaped, and external links accept only HTTP or HTTPS.

### Credentials And Startup

- Replaced process-only OpenAI availability with a Windows-user-bound DPAPI
  credential profile under the ignored private operator area.
- The profile stores no plaintext key and enables only model and read-only
  research readiness. Paid work still needs an exact Jarvis approval.
- Added one-click start and stop launchers with exact process ownership,
  encrypted control/bootstrap tokens, environment allowlisting, Node 24 checks,
  graceful shutdown, and live external actions forcibly locked.

### Observability And Operator Clarity

- Added AI Team and Live Runs views backed by focused APIs and short polling.
- Distinguished real OpenAI work, unknown provider outcomes, and internal
  rehearsals.
- Added readable evidence, counterevidence, assumptions, recommendation, tools,
  grounded sources, trace identifiers, tokens, costs, errors, and eval results.
- Deliberately excluded hidden chain-of-thought. The system shows a useful
  process record, not a false reconstruction of private reasoning.
- Retired the giant aggregate state route and machine-facing dashboard labels.

### Recovery And Clutter

- Added separate authenticated encrypted backups for source, SQLite state, and
  artifacts, including retention and staged restore validation.
- Added an atomic first-use reset manifest that preserves real accounting and
  historical provider costs while clearing pilot work from the active runtime.
- Moved superseded plans, prior master/build logs, and pilot reviews to a dated
  historical archive without deleting them.

## Dependency And Code Review

- Production dependency audit: zero known vulnerabilities at review time.
- JavaScript syntax check covers `src`, `scripts`, and `test`.
- No use of `eval`, `new Function`, `document.write`, browser storage, or
  cross-window messaging was found.
- Child processes use fixed executables with argument arrays; no shell-built
  command receives runtime business input.
- SQL parameters are bound except for fixed migration allowlists and the now
  allowlisted metadata table selector.

## Residual Risks

- Jarvis trusts the signed-in Windows account. A compromised Windows session can
  access the dashboard and its local encrypted credential, so device security
  remains part of the boundary.
- The server is intentionally loopback-only and does not provide TLS or remote
  multi-user access. Remote access must be separately designed, not exposed by
  port forwarding.
- Model output can still be wrong or commercially weak. Structured outputs,
  evidence provenance, evals, five-run capability promotion, and Daniel's
  consequential approvals reduce this risk but do not remove it.
- Provider billing remains estimated until reconciled against provider records.
- The dependency audit is a point-in-time result and should be repeated during
  meaningful dependency upgrades.
- No third-party penetration test has been performed.

## Release Proof

- Full automated suite: 118 of 118 passed locally and from a fresh clone.
- Recovery: source, database, and artifact backups authenticated and restored;
  restored SQLite integrity passed with no foreign-key violations.
- Reset: manifest `48ca93d83fe83f0e79daa3f598c62f9d3309d01435fa8ac6c46b084f6b662e47`
  applied; real AUD accounting and A$0.05 provider usage remained exact.
- Clean checkout: lockfile install, tests, clean database seed, and healthy
  isolated server start passed at commit `bd07d2c`.
- Operations: launcher ownership, graceful stop, restart, doctor, focused APIs,
  signed session, CSRF, and WebSocket security passed.
- Browser: Command Center, Decisions, Business Tests, AI Team, Live Runs, and
  System passed in a real browser with no console errors. Layouts passed at
  1440x900, 1280x720, 1024x768, 390x844, and 320x568 without horizontal
  overflow or clipped controls.
- Dependencies: production audit reported zero known vulnerabilities.
- Publication: the verified code baseline was pushed to the private repository
  on `main` at `bd07d2c`.

No paid OpenAI call or external business action occurred during verification.

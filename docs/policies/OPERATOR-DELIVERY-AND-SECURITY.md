# Operator Delivery And Security Policy

Status: active operator guidance
Last reviewed: 2026-07-22

This document explains Pantheon's delivery and local-security boundaries in
plain language. It is not executable configuration. Enforcement lives in
`AGENTS.md`, `src/runtime/pantheon-policy.js`, `src/runtime/approval-scope.js`,
`src/runtime/local-security.js`, the provider adapters, and their tests.

## Delivery

- The authenticated local dashboard is Daniel's normal control and delivery
  surface.
- SQLite is the source of truth for ventures, journeys, work, approvals,
  evidence, costs, decisions, events, and results.
- Canonical customer and operator files live under the ignored runtime artifact
  roots and must remain linked to a recorded deliverable.
- Email, mobile, work-management, accounting, marketplace, and supplier
  connections are not sources of truth. They remain unavailable until a tested
  adapter is explicitly implemented.
- A consequential decision pack must state what is proposed, the evidence and
  assumptions, expected cost and risk, the exact decision, and what each choice
  will do.

## Local Security

- Secrets, API keys, OAuth tokens, cookies, recovery codes, and identity records
  must not be committed to the repository.
- Pantheon remains bound to localhost. Remote access requires a separate
  identity, TLS, authorization, and threat review.
- Browser and computer control may verify Pantheon locally but may not perform
  publishing, customer contact, account, KYC, payment, legal, or other protected
  actions without the exact operator authorization required by `AGENTS.md`.
- External adapters must expose truthful readiness and a dry-run path before
  credentials can make them appear operational.
- Runtime logs and model context must exclude credentials and unnecessary
  personal identifiers.
- Historical files under `archive/historical/` are reference material, not
  active instructions.

## Historical Material

The pre-Pantheon global guardrails and POD taste memory were moved to
`archive/historical/` on 2026-07-22. They may inform later work but do not grant
runtime authority or define current system behavior.


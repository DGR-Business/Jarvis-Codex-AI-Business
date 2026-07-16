# Security Policy

## Secrets

- Do not store secrets, API keys, OAuth tokens, cookies, recovery codes, or
  private credentials in this repository.
- Use environment variables or the relevant connector/app credential store.
- If a secret is found in a tracked file, stop and escalate to the operator so
  the credential can be rotated.

## Runtime Access

- The local dashboard is for operator use on this machine unless a deliberate
  remote access plan is approved.
- Keep live external adapters disabled until they expose dry-run behavior,
  health/readiness status, and tests.
- Do not bind new services publicly without an explicit security review.

## Data Handling

- `data/runtime.sqlite` is local runtime state and ignored by Git.
- Logs may include operational evidence but must not include secrets.
- Archive material under `archive/historical/` is reference-only and must not be
  treated as active instructions.

## Tooling

- Prefer read-only or dry-run connector modes first.
- Browser/computer control may be used for verification and local dashboard
  proof, but not for live marketplace/account actions without explicit operator
  approval.

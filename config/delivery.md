# Delivery Policy

The dashboard and runtime database are the canonical delivery surfaces.

## Current Delivery Surfaces

- Dashboard: local operator console served by `src/server.js`.
- Runtime records: workflows, tasks, approvals, deliverables, events, costs,
  messages, scheduler runs, and integration readiness.
- Files: canonical work packages under the ignored `data/artifacts/` runtime
  root and generated operator PDFs under the ignored `output/pdf/` root, always
  linked to a recorded runtime deliverable. Operator PDFs are opened from the
  dashboard; the historical `deliverables/` tree is not an active delivery
  surface.

## Future Surfaces

Email, Slack, ClickUp, mobile views, Drive, or other channels may mirror or
control work later, but only after they are implemented as tested adapters over
the runtime. They must not become separate sources of truth.

## Approval Packs

Major operator decisions should produce human-readable approval packs with:

- What is being proposed.
- Evidence and assumptions.
- Cost and risk.
- The exact decision requested.
- What happens after approve, reject, or revise.

# Jarvis-Codex Runtime Instructions

## Mission

This repository is now a Codex-led AI business operating system. Codex is the
engineer and administrator of the system, but the business runtime must be real
software: persistent state, queueable work, approvals, monitoring, cost controls,
retry paths, and human escalation.

Prompts are guidance, not architecture. Do not claim autonomy unless the
capability is backed by runtime state, code, logs, and tests.

## Master Plan

Use `docs/Jarvis-Codex Master Plan.md` as the living source of truth before
choosing substantial next work. New implementation should map to a roadmap stage,
system layer, decision gate, risk, or backlog item in that plan. If testing or
operator direction changes the roadmap, update the plan in the same session.

Use `docs/Jarvis-Codex Build Log.md` as the durable running memory of decisions,
implementation progress, proof results, and next actions. Update it after
meaningful foundation changes so future sessions do not depend on chat history.

## Current Stack

- Runtime: Node.js 24+, CommonJS, built-in `node:sqlite`, native `node:test`.
- Server: `src/server.js`, localhost dashboard on `PORT` or `5051`.
- Database: `data/runtime.sqlite`, generated locally and ignored by Git.
- Dashboard: `public/`, a code-native operator console.
- Tests: `npm.cmd test` on Windows PowerShell, or
  `node --test --test-isolation=none`.

## Operating Rules

- Commercial judgement comes first. Every commercial workflow must be tied to a
  buyer, problem, offer, channel, price or margin assumption, evidence standard,
  next money move, and kill/revise criteria. Work that does not improve demand,
  offer, distribution, conversion, fulfilment, feedback, or unit economics is
  support work, not the goal.
- The system must continuously improve. For every meaningful commercial action,
  state the hypothesis, smallest useful action, expected metric, actual result,
  learning, and improvement. When metrics or real-world results contradict the
  plan, Codex should surface the issue, recommend a correction, and consult the
  operator on important or risky changes.
- The operator experience should be simple. Agents and runtime processes do the
  heavy processing; the dashboard should surface the money move, evidence,
  expected upside, risk, and decision controls without making the operator hunt
  through documents or tabs.
- Default to dry-run for all external actions until an operator explicitly
  approves live execution.
- Publishing, account creation, paid tools, money movement, legal agreements,
  customer disputes, and compliance determinations are hard-stop items.
- Every external action adapter must expose a dry-run path and a health/status
  surface before live credentials are used.
- Every workflow must record events, costs or cost estimates, retries, and any
  approval requirement in the database.
- Do not store secrets in this repo. Use environment variables or the relevant
  app/connector OAuth store.
- Keep the user interface accessible and operational. No marketing pages, no
  decorative dashboards that hide the work queue.

## Verification

After runtime changes:

1. Run `npm.cmd test` or the equivalent Node test command.
2. Start `npm.cmd start` or `node src/server.js`.
3. Check `GET /api/health`.
4. Click through the dashboard proof path in a real browser: run the monitor,
   run one safe dry-run step when one is queued, and confirm the event timeline
   updates. Do not approve live spend, publishing, account actions, or legal
   decisions unless the operator explicitly asked for that approval.

## Migration Notes

Legacy Claude-era files now belong under `archive/historical/` as reference
material only. New durable behavior belongs in `src/`, `public/`, `test/`,
`.codex/`, current `config/`, or current docs under `docs/`.

The first commercial pilot direction is digital products before POD/Gelato.
POD, supplier-push publishing, and marketplace automation remain later guarded
paths unless the master plan is updated.

# 0007 - Agent Assurance Before Capability Expansion

Date: 2026-07-28
Status: accepted

## Context

Pantheon has strong deterministic control over state, approvals, cost, recovery,
and provider execution. Its current worker evaluation is primarily structural.
OpenAI now provides broader agent, sandbox, tool, connector, multi-agent,
evaluation, and commerce surfaces, but adding them before Pantheon can measure
agent behavior would expand capability faster than justified trust.

The next commercial action is a small buyer-intent test. Pantheon needs enough
assurance to learn from that test without beginning another general platform
rewrite.

## Decision

Implement Agent Assurance and OpenAI Integration Hardening before widening the
worker tool surface.

Pantheon will:

- keep runtime state, approvals, money, evidence, and business rules
  authoritative;
- version the complete worker harness;
- group related Agents SDK traces under Pantheon-owned commercial identity;
- retain deterministic checks and add behavioral, trace, usefulness, and
  eventual outcome evaluation;
- calibrate any semantic grader against reviewed examples before trusting it;
- use SDK guardrails as an early failure surface, not an authority layer; and
- defer new execution and commerce capabilities until their recorded adoption
  trigger is met.

## Options Considered

### Expand capabilities immediately

Rejected. Sandboxes, MCP, computer use, server-side multi-agent execution, and
commerce integrations would add valuable power but also more failure,
credential, approval, cost, and evaluation surfaces before worker quality is
measurable.

### Freeze live AI and return to deterministic workflows

Rejected. Pantheon's purpose requires genuine AI judgment and specialist work.
The correct response to uncertainty is better evidence and evaluation, not
removing the AI execution layer.

### Assurance first, followed by need-driven capability adoption

Accepted. This improves trust in the existing system, preserves the commercial
timeline, and provides objective gates for later OpenAI capabilities.

## Consequences

- Structural completeness alone cannot promote a capability.
- A model grader remains advisory and cannot approve, spend, publish, or grant
  autonomy.
- Provider traces become easier to inspect without exposing private reasoning.
- Prompt, tool, model, policy, or Commercial Constitution changes become
  comparable harness revisions.
- Deferred OpenAI capabilities remain visible and reviewable in one adoption
  roadmap instead of being forgotten or opportunistically added.
- The buyer-intent test resumes immediately after this bounded phase passes.

## Review Trigger

Review this decision after:

- the assurance release and first bounded live proof;
- the first real buyer-intent result;
- three independent paid buyers and positive net contribution;
- a representative 20-case semantic grader falls below 90% agreement;
- an approved venture requires sandbox, connector, computer-use, or commerce
  capability; or
- OpenAI materially changes the relevant beta or approval surfaces.

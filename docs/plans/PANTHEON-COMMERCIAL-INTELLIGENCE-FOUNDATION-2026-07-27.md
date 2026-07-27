# Pantheon Commercial Intelligence Foundation

Date: 2026-07-27
Status: implemented and release-verified
Owner: Daniel
Technical steward: Jarvis (Codex)

## Goal

Make Pantheon recoverable, easy to control, commercially rigorous, and capable
of selecting one genuinely investable venture from broad market evidence.

This goal ends at an investment decision. It does not build, publish, contact a
customer, create an account, advertise, or move money. No investment is a valid
successful result.

## Implemented Foundation

### Recovery and operations

- Encrypted coherent recovery sets cover source, SQLite state, artifacts,
  decision packs, and private references.
- The Windows control shell exposes Stopped, Standby, and Working states.
- Standby leaves the dashboard control surface available without scheduler,
  Agents SDK workers, or writable business runtime.
- Graceful shutdown drains work; emergency stop marks dispatched provider work
  unknown and targets only Pantheon-owned processes.
- Ten repeated lifecycle cycles are covered by an automated Windows proof.
- A weekly Jarvis engineering and commercial audit is active for Sundays at
  18:00 Brisbane time. It may repair tested, reversible, low-risk technical
  faults but cannot authorise paid calls or protected external actions.

### Commercial intelligence

- `config/commercial-constitution.js` is the machine-readable decision method.
- `config/commercial-knowledge-v1.js` contains 60 reviewed propositions across
  12 commercial areas.
- SQLite FTS5, tags, jurisdiction handling, query expansion, and focused
  task-scoped context deliver only relevant cited knowledge to a worker.
- The 20-case retrieval and application evaluation passes at least 90%,
  including contrary and jurisdiction-specific cases.
- `CommercialInvestmentReview` applies ten mandatory gates and preserves
  advance, research-more, park, reject, and no-investment outcomes.
- Service trials require a public-data baseline, decision gap, A$25 ceiling,
  measured evidence-quality improvement, cost per useful finding, and a
  retention threshold.
- The repository-local `pantheon-commercial-steward` skill applies the same
  constitution to Jarvis development and maintenance.

### Venture-neutral architecture

- Portfolio research uses the inactive `venture-portfolio-controller`
  workspace, not the active operating venture.
- `Portfolio Controller v1` runs at most two evidence rounds, five opportunity
  spaces per round, three comparable finalists, finance review, and one Sol
  investment review.
- Opportunity Scout now creates bounded hypotheses without pretending its model
  knowledge is market evidence. Live web research is reserved for the three
  finalists.
- `VentureKitRegistry` registers `digital_product_v1` as one non-universal kit.
  Physical, white-label, affiliate, software, and service opportunities cannot
  be misclassified as digital products merely because their titles contain
  words such as bundle, tracker, or toolkit.
- The compatibility layer remains for the historical Full Journey, but generic
  Portfolio APIs require explicit ownership and do not assume Gumroad.
- Historical workbench, pilot, playbook, model-readiness, and comparison
  evidence is mapped into one capability-assurance read model without deleting
  its proof history.

### Operator experience

- The desktop cockpit includes Command Center, Full Journey, Decisions,
  Portfolio, AI Team, and System sections.
- Portfolio shows ordinary-language next work, opportunities, investment cases,
  focused business knowledge, and research-service trials.
- The Command Center cannot bypass Portfolio and start production before an
  investment case passes.
- Completed weak candidates become parked or rejected instead of looking
  half-active.
- Technical timeout history is retained in System while the Command Center
  shows one accounting note rather than duplicate chores.

## Live Commercial Result

Pantheon completed two bounded evidence rounds after one developer recovery:

- 10 opportunity hypotheses across digital products, POD, affiliate,
  white-label, software, and productised services;
- six finalists received attributable live demand research;
- all six received finance and unit-economics review;
- two Sol Chief of Staff investment reviews compared the best finalist with its
  alternatives and doing nothing; and
- no candidate qualified for investment.

The strongest retained cases were:

- Job Search Evidence Tracker: the problem exists, but willingness to pay,
  acquisition economics, and differentiation from capable free substitutes
  remain unproven.
- Freelancer client-onboarding operations service: the category exists, but
  demand for the exact no-migration fixed-scope offer, channel fit, and net
  contribution remain unproven.

Pantheon did not build the historical Job Search product or substitute a
different candidate merely to finish the goal.

## Provider and Cost Truth

- 21 Portfolio provider attempts were recorded.
- 19 have known outcomes and A$4.54 combined incurred estimates.
- Two Scout requests timed out after dispatch. Their exact outcome and billing
  are unknown, so Pantheon holds A$10.00 of conservative possible exposure and
  did not retry them.
- This goal therefore added A$14.54 of exposure, not A$14.54 of settled spend.
- July's complete dashboard exposure is A$16.54 under the A$100 mandate.
- One Demand Validator and one Finance response were known but truncated. Each
  used its single explicit compact correction and then passed.
- No provider fallback, production, publishing, customer contact, account
  action, advertising, agreement, legal decision, or money movement occurred.

## Outcome and Next Gate

The foundation proved that Pantheon can refuse weak investments. It did not
prove that public web research alone can consistently identify an investable
venture.

The private Windows CI release run for implementation commit `a6db9c4` passed
locked Node and pinned Python installation, zero-warning lint, all 268 isolated
tests, the critical dependency audit, and job cleanup. The release review also
fixed a genuine hosted-Windows launcher race by recognising wrapped file-lock
contention without weakening process ownership or readiness checks.

The next commercial goal must close a decision-critical evidence gap through
better market evidence, a measured research-service trial, a Daniel-submitted
idea, or a bounded direct buyer-intent method. It must not run another generic
broad scan or build a product until new evidence justifies reopening an
investment case.

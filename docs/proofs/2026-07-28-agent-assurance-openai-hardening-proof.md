# Agent Assurance And OpenAI Hardening Proof

Date: 2026-07-28
Status: locally complete; private GitHub CI pending
Owner: Daniel
Technical steward: Jarvis (Codex)

## Result

Pantheon now binds every live specialist attempt to a complete versioned
harness, groups related OpenAI traces under stable Pantheon-owned commercial
work, applies deterministic Agents SDK guardrails, evaluates behavior separately
from output structure, and presents the evidence in an ordinary-language Live
Runs view.

Pantheon remains the source of truth for business state, approvals, tools,
costs, retries, evidence, and outcomes. The Agents SDK runs bounded specialist
loops inside that authority. No external action, publication, customer contact,
account action, legal action, or money movement was enabled by this release.

## Live Proof

The proof used one isolated controlled Demand Validator subject and no tools.
The final accepted Luna subject recorded:

- model: `gpt-5.6-luna`;
- trace: `trace_269945141c9140d2a6fd8bdb73ef6b47`;
- trace group:
  `pantheon_group_e8e701849a7d7e279a7b693d774c9ed770254a27`;
- harness hash:
  `1be4dbbfb5e105e89f660a930fcff1266c201d69a556cdc6a489406d6acfb5c7`;
- structural assurance: passed;
- behavioral assurance: passed at 100;
- trace assurance: passed at 100;
- operator usefulness: pending review;
- commercial outcome: not measured; and
- estimated cost: A$0.01, final provider bill pending.

Two earlier Luna calls produced known, commercially bounded responses but
exposed false negatives in local assurance rules. Jarvis corrected the rules,
versioned the policy and dataset, replayed the exact retained responses, and
did not treat either old failure as a provider or commercial success. The
corrections narrowed external-action inspection to actual completion claims
and stopped the phrase `cap in advance` from being parsed as an instruction to
advance a venture.

The first Terra advisory review returned a known provider response at the
600-token ceiling, but its strict JSON was truncated. The old failure path had
discarded the local trace identifier. Pantheon reconstructed a conservative
A$0.05 priced upper estimate, recorded the missing trace as a limitation, and
did not retry automatically.

One separately visible corrected Terra attempt used a 1,000-token ceiling:

- model: `gpt-5.6-terra`;
- trace: `trace_9c2ec9fccad94ea6b1f95978f05a59ad`;
- response: `resp_0b111108783f26eb016a681421d4fc819b8f9cf0323940ee8f`;
- trace group: the same exact Pantheon group as the Luna subject;
- measured usage: 1,793 input, 473 output, 2,266 total tokens;
- estimated cost: A$0.02, final provider bill pending; and
- outcome: known structured advisory verdict.

Terra did not provide a ceremonial pass. It found that the Luna output was
honest about the absence of real demand and payment evidence, but that
`Operator decision: approve` was ambiguous and the proposed test still lacked
a defined audience, channel, exposure or sample cap, and pass/fail threshold.
The reviewer remains `advisory_not_calibrated`; its verdict changed no business
state and granted no autonomy.

Total estimated exposure across all three Luna calls, the recorded failed Terra
response, and the corrected Terra response is A$0.10. This remained below the
approved A$2 assurance-proof ceiling. The estimate uses Daniel's recorded
A$1.432727 cash-paid conversion per US dollar for the latest API credit
purchase. No amount is presented as reconciled provider billing.

## Assurance Surface

The implemented assurance stack includes:

1. exact runtime and structural checks;
2. 25 versioned reviewed behavioral cases, including held-out and contradictory
   examples;
3. trace, tool, cost, receipt, and recovery checks;
4. an operator usefulness verdict; and
5. a commercial outcome state that remains unmeasured until a real test occurs.

Structural success cannot promote a capability when behavioral assurance
fails. The semantic reviewer receives no hidden expected label and cannot
approve work, change runtime state, or grant autonomy. It remains advisory
until at least 20 reviewed cases, including at least five held-out cases, reach
90% overall and held-out agreement.

## Verification

- Full isolated Node suite: 294 of 294 passed after the dependency update.
- ESLint: passed with zero warnings.
- `git diff --check`: passed; only expected Windows line-ending notices.
- Dependency audit: zero known vulnerabilities at moderate or higher severity.
- Pantheon Doctor: operations-ready.
- Recovery: the current encrypted OneDrive recovery set passed decryption,
  manifest, inventory, and SQLite verification.
- Browser: passed at 1440x900, 1280x720, and 1024x768.
- Browser console: no warnings or errors.
- Layout: no root or detail-panel horizontal overflow; both operator-review
  actions remained visible at 1024x768.
- Lifecycle: the isolated browser-proof instance drained and stopped, its
  process tree was verified, and port 5057 was free afterward.

The isolated databases and proof JSON remain local and ignored by Git. They are
retained for Jarvis audit and later provider-cost reconciliation.

## Honest Limitations

- The live subject used controlled evidence, not current web research.
- No buyer, sale, conversion, contribution, refund, or support result exists.
- The Terra reviewer is useful evidence but is not calibrated authority.
- The failed 600-token Terra response has a conservative upper estimate because
  the old path did not preserve measured usage or its trace identifier.
- Cache savings were not observed and are not claimed.
- Broader tools, Sandboxes, MCP, computer use, Commerce, dynamic specialists,
  and server-side Multi-agent remain behind their recorded adoption gates.

## Next Commercial Action

Before external testing, make the interest-test decision packet explicit about
the audience, authorized channel, exposure or sample cap, qualification
question, pass threshold, revise threshold, and stop rule. Then prepare only
the smallest functional sample and measurement-ready buyer-intent test for the
parked Social Media Manager Client-Control and Profitability case. A full
catalogue and Venture Kit remain blocked until attributable buyer and
all-in-contribution evidence changes its failed economics gate.

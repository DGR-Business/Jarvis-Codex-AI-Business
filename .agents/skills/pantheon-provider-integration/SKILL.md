---
name: pantheon-provider-integration
description: Implement or change an approved Pantheon provider adapter after a Provider Decision Record authorizes sandbox work.
---

# Pantheon Provider Integration

- Verify the approved Provider Decision Record and current official docs.
- Define provider and capability manifests.
- Use least-privilege auth references and never print or commit secrets.
- Implement sandbox/test mode, idempotency, retries, timeouts, async jobs and verified webhooks where relevant.
- Normalize outputs, errors, cost, quota, health and provenance.
- Add contract, redaction, failure-classification and rollback tests.
- Do not activate live authority or spend outside the package.

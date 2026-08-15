# Fresh-Agent Package Reconciliation Prompt

Use when a new Codex or Claude session is opening a package that may contain prior work.

```text
Reconstruct the current state of Pantheon v2.1.1 work package [ID] from the
repository. Read the governing documents, inspect ACTIVE_HANDOFF.md, git status,
git diff, recent commits, tests and evidence. Do not edit yet.

Report:
1. objective and authority;
2. acceptance criteria already satisfied;
3. remaining work;
4. uncommitted or ambiguous changes;
5. current failures and their classification;
6. exact first safe action.

Stop after the reconciliation report unless this session was explicitly opened
as the implementation session for the package. A standalone reconciliation
ends exactly:
PACKAGE RECONCILIATION COMPLETE: IMPLEMENTATION AUTHORITY REQUIRED
```

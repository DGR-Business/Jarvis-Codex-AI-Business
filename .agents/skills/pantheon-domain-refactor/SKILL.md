---
name: pantheon-domain-refactor
description: Extract or split a large Pantheon legacy module while preserving behaviour and rollback.
---

# Pantheon Domain Refactor

- Characterize current behaviour first.
- Introduce or preserve a stable facade.
- Extract one coherent slice.
- Do not combine broad cleanup with functional change.
- Preserve dependency direction and database boundaries.
- Verify parity with targeted tests and required full regression.
- Remove legacy code only after the replacement is proven and rollback is understood.

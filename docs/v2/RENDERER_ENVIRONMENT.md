# Renderer Environment

Pantheon's local workbook, image and PDF renderers use one checkout-local
virtual environment at `/.venv-renderer/`. The directory is generated,
Git-ignored and excluded from source backups. Never copy it between checkouts;
recreate it from the tracked exact pins instead.

## Bootstrap and validation

From the repository root, supply an absolute path to a pre-existing base
CPython 3.13 installation:

```powershell
npm.cmd run renderer:bootstrap -- --python C:\absolute\path\to\python.exe
npm.cmd run renderer:check
```

Bootstrap verifies the base interpreter, creates a non-system-site virtual
environment, and installs `requirements-runtime.txt` through that environment's
`python -m pip`. Pip runs with isolated configuration, an environment-local
cache, the public PyPI index, no user site and no inherited custom index
credentials.
Re-running bootstrap safely reuses an exact-ready environment. Add
`--recreate` only when a clean rebuild is required; deletion is guarded to the
exact repository `/.venv-renderer/` target.

Local discovery uses the canonical interpreter derived from the repository
root. If `PANTHEON_PYTHON` or `JARVIS_PYTHON` is supplied, both must be coherent
absolute aliases of that exact interpreter. Missing, single, relative,
conflicting, foreign or version-mismatched aliases fail closed. The only
external-interpreter exception is a coherent `actions/setup-python` interpreter
at the exact `pythonLocation` installation entry for the exact GitHub-hosted
checkout; it receives the same exact-pin and `pip check` validation. There is no
managed-Python, user-cache or bare-command fallback.

## Dependency policy

- Keep all four direct renderer requirements as exact `==` pins. Do not use
  ranges or add unrelated top-level distributions.
- Review official stable and security releases at least quarterly, and promptly
  when a relevant security release is published.
- Try the newest stable candidate set in a clean environment. Before promotion,
  run the focused environment, renderer artifact, deterministic output,
  structure and Doctor checks, then lint and the complete ordinary suite with
  both Python aliases absent.
- Retain the newest stable version that has actually passed Pantheon's checks.
  If an older pin remains, record the dated failing check, isolated rollback
  result and reason in the package completion evidence.

This policy creates no bot, timer, provider action or separate assurance
system. Checkout provisioning remains a local prerequisite; a restored or
newly integrated checkout must run bootstrap and validation before rendering.

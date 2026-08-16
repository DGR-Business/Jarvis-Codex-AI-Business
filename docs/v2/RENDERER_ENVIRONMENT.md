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
environment, and installs the complete exact inventory in
`requirements-renderer-lock.txt` through that environment's `python -m pip`.
It uses no dependency resolution beyond those seven exact releases. Pip runs
with isolated configuration, an environment-local cache, the public PyPI
index, no user site and no inherited custom index credentials.
Re-running bootstrap safely reuses an exact-ready environment. Add
`--recreate` only when a clean rebuild is required; deletion is guarded to the
exact repository `/.venv-renderer/` target.

Local discovery uses the canonical interpreter derived from the repository
root. If `PANTHEON_PYTHON` or `JARVIS_PYTHON` is supplied, both must be coherent
absolute aliases of that exact interpreter. Missing, single, relative,
conflicting, foreign or version-mismatched aliases fail closed. The only
hosted special case is that `actions/setup-python` supplies the verified base
interpreter used to bootstrap the checkout-local environment. It is never the
ordinary renderer runtime. Hosted and local ordinary tests use the same
canonical checkout-local interpreter. There is no managed-Python, user-cache,
external-runtime or bare-command fallback.

## Dependency policy

- Keep `requirements-runtime.txt` limited to the four direct exact roots:
  openpyxl 3.1.5, Pillow 12.3.0, pypdfium2 5.13.0 and reportlab 5.0.0.
- Keep `requirements-renderer-lock.txt` equal to exactly those four roots plus
  charset-normalizer 3.5.1, et_xmlfile 2.0.0 and governed pip 26.2.1. Do not use
  ranges, add another distribution or create a second dependency-state system.
- Validation normalizes distribution names and rejects every unexpected,
  missing, duplicate-normalized or version-drifted metadata record before
  requiring all seven imports and `pip check` to pass.
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

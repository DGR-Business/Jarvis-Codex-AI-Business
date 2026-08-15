# Windows Repository Path Migration: `C:\Pantheon`

This procedure changes only the **local Windows folder path**. It does not
rewrite Git history, change branches or require the GitHub repository to be
renamed.

## Do not create a second active master repository

Do not copy the existing repository and begin working from the copy. A copied
`.git` directory creates two plausible masters, duplicated untracked runtime
state and a high risk that Codex, Claude Code or Pantheon opens the wrong one.

A temporary offline backup or archive is sensible, but only one folder should
remain the active master worktree.

## Preconditions

1. Stop Pantheon.
2. Stop Codex and Claude Code.
3. Close terminals, editors and browser tooling whose working directory is the
   old repository.
4. Open PowerShell in the current repository and run:

```powershell
git status --short
git rev-parse --show-toplevel
git remote -v
git worktree list --porcelain
```

5. Commit, stash or otherwise preserve important uncommitted work. Do not
   discard it.
6. If `git worktree list --porcelain` shows linked worktrees in addition to the
   main worktree, finish and remove them before moving the main repository where
   practical. If they must be retained, record every path and plan to run
   `git worktree repair` after the move.
7. Create a backup using the existing Pantheon backup process or an offline
   archive. Do not use the backup as a second active master.
8. Confirm `C:\Pantheon` does not already exist.

## Move the repository

Open a new PowerShell window **outside the old repository** and set the exact old
path:

```powershell
$OldRepo = 'C:\FULL\OLD\PATH\Jarvis-Codex-AI-Business'
$NewRepo = 'C:\Pantheon'

if (-not (Test-Path -LiteralPath $OldRepo)) {
    throw "Old repository not found: $OldRepo"
}
if (Test-Path -LiteralPath $NewRepo) {
    throw "Destination already exists: $NewRepo"
}

Move-Item -LiteralPath $OldRepo -Destination $NewRepo
```

Moving the complete folder preserves `.git`, branches, history, remotes,
ignored local configuration, runtime data and artifacts.

## Verify the moved repository

Run:

```powershell
git -C C:\Pantheon rev-parse --show-toplevel
git -C C:\Pantheon status --short
git -C C:\Pantheon remote -v
git -C C:\Pantheon worktree list --porcelain
```

The first command must return `C:/Pantheon` or the equivalent Windows-normalized
path.

From the extracted v2.1.1 kit, run the non-destructive checker:

```powershell
powershell -ExecutionPolicy Bypass -File .\verify-repository-path.ps1 `
  -RepoPath 'C:\Pantheon' `
  -OldRepoPath 'C:\FULL\OLD\PATH\Jarvis-Codex-AI-Business'
```

The checker reports filenames containing the former absolute path but does not
print matching lines or secret values.

## Linked-worktree repair, only when applicable

If linked worktrees were retained and are now broken, run from `C:\Pantheon`:

```powershell
git worktree repair 'C:\FULL\PATH\TO\LINKED-WORKTREE-1' 'C:\FULL\PATH\TO\LINKED-WORKTREE-2'
```

Then rerun:

```powershell
git worktree list --porcelain
```

Do not run repair speculatively when there were no linked worktrees.

## Check local configuration

Review any filenames reported by the checker. In particular, inspect ignored
configuration for absolute values such as:

- `PANTHEON_DATA_DIR`;
- `PANTHEON_DB_PATH`;
- `PANTHEON_ARTIFACT_ROOT`;
- `PANTHEON_BACKUP_DESTINATION`;
- `PANTHEON_APPROVAL_PACK_DIR`;
- Python or browser executable paths; and
- local tool/MCP configuration.

Do not change a valid external path merely because the repository moved. Change
only values that incorrectly reference the former repository root.

## Verify Pantheon itself

Open PowerShell in `C:\Pantheon` and run:

```powershell
npm run doctor
.\CHECK PANTHEON.cmd
```

Then start Pantheon using:

```powershell
.\START PANTHEON.cmd
```

Confirm the interface opens and runtime/data are intact, then stop it using:

```powershell
.\STOP PANTHEON.cmd
```

If Node dependencies fail solely because a moved local cache or native binary
contains the former path, delete only `node_modules` and run `npm ci`. Do not
reset the repository or delete Pantheon data.

## Refresh external tools

Reopen or update:

- Codex project/worktree selection;
- Claude Code working directory;
- VS Code or other editor workspace/recent entries;
- pinned shortcuts;
- terminal profiles;
- browser bookmarks that use local file paths;
- Windows Task Scheduler entries or startup shortcuts, if any; and
- local MCP/tool configuration that stores the old absolute path.

Start fresh Codex and Claude sessions from `C:\Pantheon`. Do not continue a
coding session that was opened against the old root.

## Rollback

If verification fails for a path-related reason and no new work has begun:

1. stop Pantheon and all coding tools;
2. move `C:\Pantheon` back to the exact former path;
3. verify Git again; and
4. diagnose the specific absolute-path dependency before retrying.

Do not maintain both paths as active repositories.

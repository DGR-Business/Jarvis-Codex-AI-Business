# Windows Supervisor Local Proof

Date: 2026-07-28

Status: local release gates passed; private CI pending

## Decision

Pantheon's user-facing Windows lifecycle now has one durable process owner.
`START PANTHEON.cmd` starts a small native supervisor, and the supervisor starts
the standby Node process inside a Windows Job Object configured with
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.

The standby process, its PowerShell transitions, the working runtime, and any
children inherit the job. If the supervisor exits normally or is terminated,
Windows closes the final job handle and terminates the remaining Pantheon-owned
tree. Existing PID, start-time, executable-path, owner, instance, health, and
port checks remain in place as defense in depth.

This replaces descendant reconstruction as the primary containment mechanism.
It does not use broad Node termination and does not stop unrelated processes.

## Implementation

- `scripts/windows/PantheonSupervisor.cs` owns the Job Object and drains standby
  output to bounded local log files.
- `scripts/ensure-pantheon-supervisor.ps1` compiles a source-hashed executable
  with the installed Windows compiler under a 15-second deadline.
- `scripts/start-pantheon-control.ps1` launches the supervisor, verifies the
  exact supervisor and child identities, and records version 3 ownership
  metadata.
- `scripts/stop-pantheon.ps1` stops working ports before control ports, closes
  an exact remaining supervisor, discovers supervisor-only recovery records,
  and still refuses changed identities.
- Pantheon's credential-store and launcher-state locations are forwarded to
  supervised transitions without forwarding a raw API key.
- `test/windows-launcher.test.js` now proves ten complete
  standby/working/standby/stopped cycles and a forced supervisor failure.
- ordinary CI tests are split into four isolated shards after the prior
  single process reported all 296 passing tests but reached its 12-minute
  external deadline before exit.

The design follows the Windows Job Object contract documented by Microsoft:
child processes inherit job membership by default, and kill-on-close ends all
associated processes when the final job handle closes.

## Local Evidence

- supervisor compilation: passed in 1.5 seconds;
- PowerShell parser checks: passed;
- lint: passed with zero warnings;
- ordinary isolated tests: 296 of 296 passed in 119.6 seconds;
- quarantined Windows lifecycle suite: 8 of 8 passed in 235.9 seconds;
- ten-cycle supervisor case: passed in 167.4 seconds;
- forced supervisor termination removed the standby and working runtime;
- every test cycle released both ports and removed ownership records;
- an unrelated Node process remained running throughout the lifecycle proof;
- no supervisor process remained after the test; and
- no OpenAI request, paid tool, external business action, or commercial-state
  change occurred.

The pre-existing Pantheon Working instance on port 5051 was not stopped,
restarted, or modified by this proof.

## First CI Result

Commit `c32108b8bcc22ac0485c05c93443db36abe71ddd` reached private
`Pantheon checks #16`.

- `windows-lifecycle` passed in 1 minute 47 seconds.
- the ordinary `verify` job reported all 296 tests as passing but its one
  sequential process reached the 12-minute external deadline before Node
  emitted the final suite summary;
- lint and dependency installation had already passed; and
- the audit step did not run because the test step failed first.

The revised workflow keeps hard deadlines and runs ordinary test files in four
separate isolated jobs. Private CI must pass on the supervisor commit before
the local launcher quarantine is lifted.

Private `Pantheon checks #17` then proved the sharding behavior and exposed a
clean-install dependency defect that the old shared-process order had masked.
Two independent renderer shards could not import `pypdfium2`, even though
Pantheon's product renderer imports it directly. The package was absent from
`requirements-runtime.txt`. Pantheon now pins `pypdfium2==5.12.1`, matching the
reviewed July 2026 PyPI release and the locally verified renderer runtime. A
separate static test requires every imported renderer package to remain in the
locked requirements file.

This is a release improvement, not a reason to recombine the test suite:
isolated shards correctly revealed that a clean machine could not render the
product files. A new private CI run remains required.

## Remaining Boundaries

- Runtime metadata remains under the ignored repository `tmp` root. Moving it
  to a per-user application-data root remains separate migration work because
  an older owned runtime may still need to be discovered and stopped safely.
- Pantheon does not start with Windows.
- Standby remains intentionally local and lightweight.
- Emergency termination records provider calls with uncertain outcomes as
  unknown; it does not claim a graceful business shutdown.
- Buyer-intent work remains paused and no further paid correction is
  authorised by this engineering release.

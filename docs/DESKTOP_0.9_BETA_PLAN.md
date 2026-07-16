# Desktop 0.9 controlled Private Beta plan

Candidate line: `0.9.0-beta.N`

Owned issues: ATH-REL-001 and ATH-DESKTOP-001

Current disposition: **No-Go / external and field validation blocked**

## Entry gates

A build may be offered to testers only when all of the following are true:

- clean-checkout CI and the non-live regression suite pass;
- candidate manifest hashes match the uploaded files;
- installer, installed executable, uninstaller and helpers have Valid Authenticode signatures with timestamp evidence;
- Defender/SmartScreen test results are attached to the same candidate ID;
- privacy, EULA, support contact and known-limitations links are approved;
- beta channel is not paused and the rollback target is still retrievable;
- release owner, QA owner and incident contact sign the run record.

The current local unsigned candidate is not eligible for participants.

## Installation and fault matrix

Automatable installer cases run with `scripts/test-installer-matrix.ps1` on a disposable Windows VM. `PreviousInstaller` is mandatory for a real cross-version result. A missing input must remain `NOT_RUN`.

| Scenario | Required environments | Evidence | Current status |
|---|---|---|---|
| First install | Windows 10 x64, Windows 11 x64 | installer log, launch smoke, shortcut paths | Not run for signed candidate |
| In-place/overwrite upgrade | same-version repair and beta.N → beta.N+1 | exit codes, file versions, user-data preservation | Not run for signed candidate |
| Cross-version upgrade | 0.8.0 → 0.9, earliest supported 0.9 beta → current | migration backup path, schema, data sentinel | Not run |
| Uninstall | keep-data default plus explicit data-removal UX decision | remaining files and AppData inventory | Not run |
| Reinstall | after uninstall with retained user data | settings/memory compatibility and launch | Not run |
| No Ollama / no model | clean VM without Ollama and model store | understandable offline state; UI remains usable | Automated smoke available; field UX not run |
| Port conflict | non-Ollama listener on configured port | no crash, actionable endpoint guidance | Not run |
| Standard user | non-admin local account | install/update/uninstall outcome | Not run |
| UAC | consent accepted, denied and cancelled | no partial install or corrupt state | Not run |
| Defender/SmartScreen | current Windows definitions, reputation-free VM | detection names, screenshots/log export, hash | Not run |
| Weak network | loss, 400–1500 ms latency, 5–20% packet loss, interrupted update | bounded retry, pause, resumable/restart behavior, hash rejection | Not run |
| Rollback | current beta → previous approved beta | feed control audit, app version, DB/data decision | Fixture rehearsal passes; real feed not run |

UAC, Defender/SmartScreen, standard-user and weak-network results require real Windows VM or device evidence. A code-only test may not mark them passed.

## Cohort and rollout

Target 20–50 participants, staged to cap blast radius:

1. Ring 0: 3–5 internal operators for 24 hours (does not satisfy the 20-person completion gate).
2. Ring 1: expand to 10–15 after zero open P0/P1 and no migration/signature/update failure.
3. Ring 2: expand total completed participants to 20–50 for at least seven calendar days.

Each participant must have a unique pseudonymous ID, candidate ID, OS/build, install path, update path, Ollama state, start/end time, consent record, result and linked issue IDs. Do not collect chat text, prompts, memory contents, file paths, credentials or model inputs in the Beta log.

## Stop and rollback rules

Pause the beta channel immediately for any P0, data loss/corruption, signature/hash mismatch, Defender malware verdict, update loop, failed rollback or privacy-boundary breach. Pause for P1 when impact is repeatable or affects more than one participant. The incident owner decides whether to roll back to the last signed candidate or ship a signed hotfix; channel actions and participant notifications must be timestamped.

## Exit gate

ATH-DESKTOP-001 may close only when:

- 20–50 real participants completed the agreed duration on signed candidate builds;
- every required installation/fault row has reproducible evidence;
- no P0/P1 remains open;
- pause/rollback and migration recovery were rehearsed against the real channel;
- QA/Release signs the participant summary.

Until then, the issue status is `Blocked` or `In Progress`; wording such as “Beta passed” is prohibited.

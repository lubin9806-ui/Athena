# Athena Steam 1.0 Go/No-Go

> Window 08 / ATH-STEAM-001. Review date: 2026-07-16.

## Decision

**BLOCKED / NO-GO. Do not upload, submit, sell, or claim Valve approval.**

## Engineering completed

- Independent `athena-steam-personal-v1` SKU, `com.athena.steam` build config, `AthenaSteam.exe`, isolated user-data path, and SteamPipe templates
- Optional native `steamworks.js` bridge pinned at 0.4.0 with Electron 42 module-load proof
- Fail-closed Steam restart/AppID/current ownership/SteamID/private-branch checks
- Steam update ownership separated from Desktop Direct auto-update
- Full Execute, all terminals/commands/program launch, arbitrary HTTP/TCP, web search, external navigation, and external payments blocked at multiple runtime layers
- Steam Cloud encrypted record format, vector-clock conflict detection, tombstone deletion propagation, and byte bounds implemented and tested
- Window 03 Cloud whitelist remains empty and Cloud runtime disabled
- AI content survey draft, deterministic input/output guardrail, buffered Steam output, and limitations documented
- Athens-inspired minimal store/library asset set produced; five 16:9 real-runtime source screenshot candidates at or above 1920x1080 reviewed for personal-data exposure
- Source-level near-final verifier and artifact-level signed-candidate verifier implemented

## External and sequential blockers

1. Desktop 1.0 remains No-Go/Blocked and the Window 03–07 worktree has not yet been committed as a clean baseline.
2. No real Steamworks partner account, Athena AppID, DepotID, Steam Direct/tax/bank completion, or SDK release environment was available.
3. No owned-account launch, offline-mode behavior, private-branch install/update/rollback, Steam Cloud, or clean-machine redistributable test was possible.
4. No signed `AthenaSteam.exe`, real SteamPipe BuildID/depot manifest, or near-final Steam candidate exists.
5. The Steam Content Survey, Store Presence, pricing, supported territories, age/mature content answers, and AI disclosures have not been submitted.
6. Valve Store Presence and product-build review have not occurred.
7. Window 03 has approved no Steam Cloud data. Cross-device encryption key custody is unresolved.
8. The Steam depot does not bundle Ollama or a model; Product/QA must validate onboarding and review usability on a clean machine.
9. Generated store art and the Athena/Su Shixia names still require human legal/trademark/provenance signoff.

## Go conditions

Go requires every blocker above to close, `npm.cmd run build:steam` from a clean signed checkout with real IDs, `npm.cmd run steam:verify-candidate -- --candidate release-steam\win-unpacked`, owned-account/private-branch clean-machine evidence, final real-build screenshots, submitted AI survey answers matching the build, and archived Valve approvals.

# Athena Cloud 1.0 operations, SLO and drills

## Proposed production SLO

These are launch targets, not measured production achievements.

| Service indicator | 30-day objective | Measurement |
|---|---:|---|
| Auth/session API availability | 99.95% | Valid non-abusive requests not returning 5xx |
| Sync API availability | 99.9% | Valid writes/reads not returning 5xx; 409 conflicts count as correct responses |
| Model gateway availability | 99.5% | Accepted requests returning a response or policy refusal; provider 5xx counts unavailable |
| API latency excluding model provider | p95 < 500 ms, p99 < 1 s | Server duration histogram by route/status |
| Sync durability | RPO <= 15 minutes | Latest successfully verified immutable backup/replica point |
| Service recovery | RTO <= 60 minutes | Incident declaration to validated API recovery |
| Account deletion | 95% < 24 hours; 100% < 30 days absent legal hold | Deletion receipt to completion across primary, replicas and backups |
| Export | 95% < 15 minutes | Accepted job to downloadable encrypted artifact |

Error-budget policy: burn above 2x for one hour pages on-call; above 1x for six hours freezes feature rollout; budget exhaustion freezes releases except security/reliability fixes. Planned maintenance counts unless communicated and excluded by an approved customer policy.

## Signals and alerts

The local service exposes liveness, readiness and in-memory request/error/latency metrics. Production must export metrics without prompts, emails, tokens, voice or payloads.

- Page: auth/sync 5xx burn, no healthy region, KMS decrypt failure, deletion ledger verification failure, backup corruption, audit-chain failure.
- Ticket: quota anomalies, recovery spikes, repeated MFA failures, provider latency, export backlog, backup age approaching RPO.
- Security escalation: cross-tenant authorization signal, key-access anomaly, credential stuffing, backup access, provider policy breach.

Real on-call roster, paging vendor, status-page URL and security contact are not selected; they are release blockers and belong to Window 11 for cross-platform operations, while Cloud-specific runbooks and SLO remain Window 09 evidence.

## Backup and restore runbook

1. Quiesce destructive maintenance or create a consistent database snapshot.
2. Encrypt snapshot before durable storage and record digest, key version, region and timestamp.
3. Replicate to an immutable, separately authorized account/region after vendor selection.
4. Restore only to a new staging target. Verify artifact digest, AEAD, database integrity and schema compatibility.
5. Apply the signed deletion ledger before any restored service can accept traffic.
6. Compare tenant, audit and sync counts; run authorization and canary checks; obtain two-person approval.
7. Switch traffic through deployment adapter; preserve forensic artifacts and record RPO/RTO.

The implementation forbids online in-place restore. Known backups are purged on account deletion. Production needs object-lock retention and a demonstrable deletion process for immutable copies.

## Failure drill baseline

`npm.cmd run drill` executes without network or charges:

| Scenario | Injection | Expected result |
|---|---|---|
| Model provider outage | Provider throws | Bounded 503; prompt absent from storage |
| Tenant key rotation | Rotate with live encrypted data | Data remains readable; audit chain valid |
| Backup restore | Encrypted snapshot to staging | Digest, AEAD and SQLite integrity pass |
| Corrupt backup | Append bytes | Restore rejected before use |
| Primary region loss | Mark local primary unavailable | Adapter chooses local fallback in degraded state |
| Total region loss | Mark both unavailable | Readiness has no active region; no false healthy claim |
| Request flood | Exceed deterministic bucket | 429 with retry guidance |

This simulation validates control flow, not real latency, data replication or provider SLA. After vendor selection, repeat with actual zone/region isolation, KMS unavailability, DB failover, queue backlog, provider brownout, network partition and backup-account compromise. Capture timestamps and prove proposed RPO/RTO before production Go.

## Incident sequence

Detect → page → assign incident commander → contain credentials/traffic/provider → preserve privacy-safe evidence → communicate through approved status/support channels → recover through staged validation → notify regulators/users when required → complete root cause and corrective actions. Severity matrix, named roster, notification jurisdictions and public status URL remain externally blocked.

# Athena Cloud 1.0 Go/No-Go

> Window 09 / ATH-CLOUD-001 decision. Date: 2026-07-16.

## Decision

**Cloud 1.0 production release: NO-GO / externally blocked.**

**Local engineering boundary: GO for continued integration and production-provider selection.**

**Mobile 1.0 hard prerequisite: NOT SATISFIED.** Mobile may use the v1 contract for isolated development, but Mobile release, store submission and any claim of Cloud availability remain blocked until this document is reissued as production Go.

## Evidence summary

| Release-checklist item | Local engineering evidence | Production decision |
|---|---|---|
| Assets, boundaries, threat model, classification | Architecture and threat register complete; Desktop/Electron/SQLite/tools imports/routes statically rejected | Pass for design |
| Authentication, sessions, MFA/recovery, tenant isolation | scrypt, TOTP, one-time codes/tokens, token hash/rotation, device revocation, cross-tenant tests | Independent production pen test required |
| Transport, static encryption, keys, rotation, secrets | TLS production gate; AES-256-GCM envelope encryption; rotation and restore tests | KMS/HSM, real TLS/IAM and custody review missing |
| API version/idempotency/rate/quota/retry/compatibility | v1 contract, problem details, exact vectors, limits, typed conflicts, idempotency tests; Desktop persists observed per-resource vectors and proves a second update; readiness reports exact runtime adapter bindings | Distributed limiter/capacity and real multi-device soak missing |
| Model data terms/region/retention | Local fixture registry; Athena stores no prompt/voice | Real provider/DPA/region unselected |
| Content safety, abuse, block/appeal/escalation | Local block baseline, encrypted appeal and manual-review state | Policy, staffing, contact and provider review missing |
| Billing, entitlements, tax/trial/debt/refund | Replaceable state adapter; local adapter cannot charge; trial/past-due/refunded tested | Price, processor, tax, invoice/refund policy unselected |
| Export, deletion, backups, legal retention | Encrypted export; owner confirmation; purge/crypto-erase; signed deny-restore ledger | Jurisdiction/legal-hold policy and distributed deletion proof missing |
| SLO, monitoring, alerts, on-call, status, incident drill | SLO/RPO/RTO targets; local metrics and fault drill | Real capacity, paging roster, status page and production incident exercise missing |
| Backup/RPO/RTO and region/provider failure | Encrypted snapshot, checksum/integrity, staging restore, corruption/provider/region simulation | Immutable cross-account backup and real RPO/RTO/region proof missing |
| Pen test, dependency/image scan, release approval | Internal automated baseline and source-boundary verification | Independent test, image scan and signed approval missing |

## Automated proof

Run from `G:\Athena\cloud`:

```powershell
npm.cmd test
npm.cmd run drill
npm.cmd run verify
npm.cmd audit --audit-level=high --registry=https://registry.npmjs.org
```

Required markers are `ATHENA_CLOUD_DRILL_OK` and `ATHENA_CLOUD_1_0_ENGINEERING_OK`. Passing markers never turn this No-Go into production Go by themselves.

## External blockers to clear

1. Select production legal entity/owner, cloud vendor, primary and secondary regions, KMS/secrets architecture and database/backup services.
2. Select model and recovery providers; approve terms, DPA, regions, retention, training use, subprocessors, safety and deletion.
3. Freeze price/currency/tax/invoice/trial/delinquency/refund/chargeback policy and integrate a sandboxed then production billing provider.
4. Deploy production-equivalent TLS, IAM, network/egress, distributed rate limit, immutable audit and cross-account backup controls.
5. Prove capacity, 30-day SLO instrumentation, RPO <= 15 minutes and RTO <= 60 minutes through real region/provider drills.
6. Complete independent penetration test, dependency/container/image/secret scans and remediate/retest all Critical/High findings.
7. Approve legal-hold/retention and demonstrate export/deletion across replicas, provider data and immutable backups.
8. Name on-call/security/privacy owners, paging and public status/support/security channels; complete a production-equivalent incident exercise.

## ATH-CLOUD-001 disposition

Move from `Open` to **Blocked**, not Closed. The repository now contains the independent service boundary and local evidence, but the Cloud-special checklist cannot all pass without the external decisions and real environment above. A future signed decision must record exact build/commit, infrastructure revision, providers, regions, test reports, SLO interval and approvers before changing to Closed.

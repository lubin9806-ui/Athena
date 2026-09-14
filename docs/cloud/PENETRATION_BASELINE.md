# Athena Cloud 1.0 penetration-test baseline

## Scope and method

Target: local API v1, authentication/session/device flows, tenant/object/function authorization, sync concurrency, cryptography integration, rate/quota controls, model gateway, exports/deletion, backup/restore and forbidden Desktop boundaries.

The baseline maps to [OWASP API Security Top 10 2023](https://owasp.org/API-Security/editions/2023/en/0x11-t10/) and OWASP ASVS. It is an internal automated baseline, not an independent penetration test or certification.

## Automated cases

| Area | Cases | Current evidence |
|---|---|---|
| Authentication | Wrong password, temporary lock, MFA required/proved, recovery-code replay, enumeration-safe account recovery, token expiry/revocation; password policy as 400; wrong MFA codes share the lockout; MFA cannot be re-enrolled or disabled without a current code; logout frees the device slot | `cloud/test/cloud.test.js`, `cloud/test/account-hardening.test.js` |
| Authorization | Foreign tenant object, user-owned devices, owner/admin routes, tenant-scoped SQL | Tests plus `verify-cloud.js` source boundary scan |
| Session | Opaque random access/refresh, hash-only persistence, refresh rotation, device and password-recovery revocation | Tests |
| Input/API | JSON-only, unknown-property rejection, bounded body/record/list, ID/enum validation, RFC 9457 errors | HTTP integration test |
| Sync | Idempotency replay/mismatch, stale vector conflict, encrypted payload, tombstone | Tests |
| Crypto | Database plaintext probes (checkpointed, WAL file included, with a positive control proving the scan reads rows; before 2026-09-14 the probe read only the 4 KB main file and could not fail), sealed idempotency replay entries, contextual AEAD, tenant key rotation, audit chain verification, corrupt backup rejection | Tests and drill |
| Abuse/cost | IP/tenant rate, model token quota, no-charge adapter, content block and appeal | Tests |
| Privacy | No prompt in audit/storage, encrypted export, account deletion, backup purge and signed restore denylist | Tests |
| Boundary | No Electron/Desktop SQLite/computer tools/terminal/arbitrary URL routes or imports | `verify-cloud.js` |
| Resilience | Provider outage, regional failover simulation, total-region loss, restore, corruption and rate drill | `chaos-drill.js` |

## Manual/independent production test plan

The following must be performed against a production-equivalent, non-customer environment by a qualified independent tester after infrastructure/provider selection:

1. Authenticated and unauthenticated BOLA/BFLA fuzzing across every object and admin route, with two tenants and three roles.
2. Password, MFA, recovery, session fixation, refresh replay/race, device revocation and brute-force testing.
3. SQL/JSON/header/request-smuggling/injection, oversized/chunked/slow-body, parser differential and error leakage testing through the real proxy/CDN/WAF.
4. SSRF and egress testing against metadata endpoints, private networks, redirects and provider webhooks.
5. Quota/rate bypass across IP, account, tenant, device, region and concurrent workers; cost-amplification tests with hard spend caps.
6. KMS/IAM privilege review, key rotation/disable, ciphertext swapping, backup theft, restore authorization and deletion-ledger tamper tests.
7. Container/image/dependency/SBOM/secret scanning and runtime hardening review.
8. Model/provider privacy verification, prompt/log sampling, safety bypass, appeal access and upstream failure behavior.
9. Billing webhook signature, replay, ordering, duplicate invoice/refund, trial/past-due/suspension and tenant-crossing tests.
10. Region partition/failover, stale reads, concurrent sync and deletion during restore/failback.

## Exit criteria

- No open Critical/High finding.
- Medium findings have owner, deadline and verified compensating control; no Medium may affect tenant isolation, authentication, deletion, key custody or billing integrity.
- Dependency and image scans have no unwaived Critical/High issue.
- A signed report identifies build, infrastructure revision, dates, scope, tester and retest evidence.

## Current result

Internal baseline: pass when `npm.cmd run verify` and `npm.cmd run drill` emit their success markers. Independent production penetration test: **Not run / release blocker**. No claim of certification or production security approval is made.

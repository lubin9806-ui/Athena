# Athena Cloud 1.0 threat model

> Scope: `G:/Athena/cloud`, API v1, local adapters and the proposed production trust boundaries. Date: 2026-07-16. Owner: Window 09 / ATH-CLOUD-001.

## Security objectives

1. A principal cannot read, mutate, infer existence of, export or delete another tenant's objects.
2. A compromised access token has bounded lifetime and can be revoked through session/device/account controls.
3. Database, backup or export theft does not reveal protected content without external key material.
4. Concurrent sync does not silently lose data and account deletion is not reversed by backup restore.
5. Provider, billing and regional faults remain bounded and do not create unapproved cost or retention.
6. The service never becomes a remote path to Desktop Execute, files, terminal, arbitrary HTTP, Electron or Desktop SQLite.

## Trust boundaries and attackers

- Untrusted network/client to HTTP API.
- Authenticated client to tenant/user authorization boundary.
- Service process to relational store and local artifact storage.
- Service to model, recovery, billing, KMS and deployment adapters.
- Operator to backup/restore and key-rotation commands.

Attackers include unauthenticated Internet clients, malicious tenant members, compromised devices/tokens, a stolen database or backup, abusive automation, compromised providers, and an operator with excessive privileges. Physical compromise of an unlocked client and compromise of the production KMS control plane remain outside what application cryptography alone can solve.

## Threat/control register

| ID | Threat | Control implemented in local boundary | Residual / production action |
|---|---|---|---|
| T01 | Broken object-level authorization | Tenant and owner scope comes only from bearer context; object IDs are always queried with `tenant_id`; foreign tenant returns 404 | External BOLA fuzzing and production DB policy/RLS defense in depth |
| T02 | Broken function authorization | Owner/admin checks on audit, key rotation and deletion; default deny router; strict request property allowlists | Central policy review for every future route |
| T03 | Credential stuffing/brute force | scrypt, local blocked-password list, per-IP auth rate, lock after five failures, generic recovery response | Breached-password service, bot defense and risk signals require provider/privacy decision |
| T04 | Session theft/replay | 256/384-bit opaque tokens, hash-only storage, short access TTL, refresh rotation, device/session revocation, password recovery revokes all | Secure client storage, TLS certificate policy and token anomaly monitoring in production |
| T05 | MFA bypass/recovery abuse | TOTP proof, one-time hashed recovery codes, one-time 15-minute account recovery token | Prefer phishing-resistant passkeys/WebAuthn after product decision; reviewed delivery provider required |
| T06 | Tenant data disclosure in storage | Per-tenant random data key, AES-256-GCM, contextual AAD, external master key, encrypted backup/export | Managed KMS/HSM, split duty, access logging and restore environment controls |
| T07 | Key/ciphertext tampering | AEAD authentication; versioned wrapped keys; key rotation re-encrypts content and rebuilds chained audit | Independent cryptographic review and KMS rotation drill |
| T08 | Sync overwrite/data loss | Exact base vector, per-device vector increment, 409 conflict with server state, tombstones, idempotency | Real iOS/Android/Desktop multi-device soak and offline-clock tests |
| T09 | Deleted-account resurrection | Purge known backup artifacts, cryptographic erase by tenant deletion, signed external deletion ledger applied on staged restore | Immutable production deletion ledger and backup lifecycle proof across every replica/region |
| T10 | Resource exhaustion/cost abuse | 1 MiB body, 256 KiB records, request timeouts, per-IP/tenant rates, monthly model quota, device/record list bounds | Distributed limiter, WAF, queue limits, spend caps and capacity tests |
| T11 | Prompt/voice privacy leakage | No prompt or voice persistence, no prompt in audit, redaction of sensitive detail keys, provider registry | Contract/DPA verification, provider no-log configuration and egress evidence |
| T12 | Unsafe provider response/consumption | Provider adapter, bounded input/output, local content block/appeal path, provider outage becomes generic 503 | Production moderation policy, human review staffing, output safety and provider allowlist |
| T13 | Audit deletion/tampering | Per-tenant HMAC hash chain; encrypted details; verification endpoint | Append-only external log sink, retention decision and alerting |
| T14 | Backup corruption/ransomware | Consistent snapshot, AEAD, checksum, SQLite integrity check, staging-only restore, corruption drill | Immutable cross-account copies, tested RPO schedule and clean-room restore |
| T15 | SSRF/RCE/desktop pivot | No arbitrary URL fetch, shell, files, Electron, computer tools or plugin APIs; model provider is an injected interface | Egress allowlist and container/runtime hardening |
| T16 | Mass assignment/injection | Strict request key allowlists, prepared SQL, bounded IDs/enums, typed problem responses | DAST/property fuzzing and dependency scanning in CI |
| T17 | Availability/region/provider outage | Readiness, bounded provider error, local primary/fallback deployment port and drill | Real multi-zone/region topology and data consistency proof after vendor choice |
| T18 | Billing fraud/wrong charge | Default adapter cannot charge; entitlement transitions are auditable | Processor webhooks, signature/replay handling, tax/invoice/refund tests after commercial decisions |

The register explicitly covers the current [OWASP API Security Top 10](https://owasp.org/API-Security/editions/2023/en/0x11-t10/), including object/function authorization, authentication, resource consumption, business-flow abuse, SSRF, inventory and unsafe upstream consumption. Authentication design also follows the direction of [NIST SP 800-63B-4](https://csrc.nist.gov/pubs/sp/800/63/B/4/final): long passwords, blocked common values, secure verifier storage, rate limiting and multi-factor recovery controls rather than arbitrary composition rules.

## Privacy abuse cases

- An attacker probes random resource IDs: response is tenant-scoped 404, never a cross-tenant 403 oracle.
- A provider outage occurs after prompt receipt: the service writes only provider ID, duration and failure outcome; no prompt.
- A user requests export: the artifact is encrypted at rest, available only to that user, expires in 24 hours and omits credentials/keys/other users.
- An owner deletes the account: sessions, users, devices, sync data, audit ciphertext and tenant keys are removed by cascade; known backups/exports are purged and the signed deny-restore ledger remains.
- A legal hold is requested: no production legal-retention workflow is configured. Cloud release is blocked until counsel defines jurisdiction, authority, scope, access and expiry. The local path claims no hold.

## Residual risk decision

No critical threat is accepted for production. Local controls are sufficient for engineering verification only. Production remains No-Go until external penetration testing, production KMS/TLS/IAM, provider and region decisions, immutable audit/backup controls and incident operations are evidenced.

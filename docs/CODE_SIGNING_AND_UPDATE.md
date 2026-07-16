# Desktop code signing and update controls

This document is the operational boundary for ATH-REL-001. It does not record a signature as valid unless Windows reports `Get-AuthenticodeSignature.Status = Valid` for the exact candidate files.

## Signing configuration

The repository never stores a certificate, private key, password, or store credential. The signed CI job accepts these secret environment variables:

- `WINDOWS_CSC_LINK` secret, mapped to electron-builder `CSC_LINK` (base64 PFX, HTTPS secret URL, or protected file reference supported by the CI secret provider).
- `WINDOWS_CSC_KEY_PASSWORD` secret, mapped to `CSC_KEY_PASSWORD`.
- `WINDOWS_SIGNING_PUBLISHER` secret, mapped to `ATHENA_SIGNING_PUBLISHER`; this is the approved full certificate subject/DN used by `electron-updater` for Windows signer matching.
- `ATHENA_UPDATE_BASE_URL` secret, an approved HTTPS origin containing `channels/beta` and `channels/stable`.

`npm.cmd run build:release` fails when the certificate, HTTPS feed or publisher identity is absent. The build writes `app-update.yml.publisherName` into packaged resources so `electron-updater` cannot silently skip owner matching. `npm.cmd run build` may create unsigned local engineering evidence, but its candidate manifest sets `distributionAllowed: false` and records `CODE_SIGNING_CERTIFICATE_MISSING_OR_INVALID`.

Certificate procurement, legal publisher identity, hardware/cloud key custody, renewal, revocation and disaster recovery are external release-owner responsibilities. The certificate must be a Windows code-signing certificate whose publisher matches the approved product/legal identity. Timestamp evidence must appear in the candidate manifest before release sign-off.

## Version and build identity

- `package.json` is the semantic version source: `0.9.0-beta.N` maps to `beta`; `x.y.z` maps to `stable`.
- `package-lock.json` must match. Application code imports `package.json` for `APP_VERSION` rather than duplicating a literal.
- `scripts/prepare-release.js` writes packaged `.build/build-info.json` containing commit, channel, UTC build time and SHA-256 over release inputs.
- A CI release build requires a clean checkout. A local dirty build is allowed only as engineering evidence and is explicitly marked.
- `scripts/generate-candidate-manifest.js` copies the exact installer/blockmap to `release/candidates/<candidate-id>/`, hashes every artifact, inspects Authenticode and records Beta status without inventing participants.

## Beta and stable channels

The channel store is a static directory that can be uploaded to an authenticated HTTPS object store/CDN after infrastructure approval:

```text
channels/
  beta/
    control.json
    latest.json
    rollback.json
    candidates/<candidate-id>/...
  stable/
    control.json
    latest.json
    rollback.json
    candidates/<candidate-id>/...
```

Only a candidate whose artifact hashes match and whose executable Authenticode status is currently `Valid` can be staged by the CLI:

```powershell
npm.cmd run release:channel -- stage --feed X:\athena-feed --channel beta --manifest release\candidates\<id>\candidate-manifest.json
npm.cmd run release:channel -- pause --feed X:\athena-feed --channel beta --reason "INC-123 crash regression"
npm.cmd run release:channel -- resume --feed X:\athena-feed --channel beta
npm.cmd run release:channel -- rollback --feed X:\athena-feed --channel beta --manifest X:\approved\previous\candidate-manifest.json --reason "INC-123 rollback"
```

Pause leaves the last approved pointer intact but sets `control.json.paused = true`; distribution infrastructure must deny new update downloads while paused. Rollback revalidates the target candidate, moves `latest.json` to that immutable candidate, writes `rollback.json`, then resumes the channel. The automated regression uses marked fixtures only and must never be cited as real signing or real update-host evidence.

## Required production rehearsal

Before ATH-REL-001 can close, the release owner must archive:

1. a successful signed `desktop-v0.9.0-beta.N` CI run from clean checkout;
2. Valid signer and timestamp evidence for installer, installed `Athena.exe`, uninstaller and any helper executable;
3. authenticated HTTPS feed upload and client-side download/hash verification evidence;
4. pause and rollback rehearsal against the real feed, including audit timestamps and owner;
5. key rotation/revocation drill and recovery owner;
6. successful database backup, migration, injected-failure restoration and downgrade/rollback data decision.

Until those items exist, ATH-REL-001 remains `Blocked`, not `Closed`.

# Desktop Signed Private Beta Execution

> Status: prepared but externally blocked. This runbook does not authorize distribution of an unsigned build.

## 1. Required external inputs

Before building a participant candidate, the release owner must provide all of the following in the protected CI environment:

- `WINDOWS_CSC_LINK`: controlled Authenticode certificate or signing-service input.
- `WINDOWS_CSC_KEY_PASSWORD`: certificate password or protected signing credential.
- `WINDOWS_SIGNING_PUBLISHER`: exact certificate subject expected by the application updater.
- `ATHENA_UPDATE_BASE_URL`: controlled HTTPS beta update origin.

The legal publisher name displayed by Windows, the certificate subject, the website, EULA, privacy policy and support identity must refer to the same approved publisher. Secrets must not be committed to this repository.

## 2. Candidate build

Run from a clean checkout or trigger the `Desktop 0.9 Beta` workflow with `signed_candidate=true`:

```powershell
npm.cmd ci
npm.cmd run rebuild:sqlite:electron
npm.cmd run release:preflight
npm.cmd run build:release -- --require-clean
& '.\release\win-unpacked\Athena.exe' --smoke-test
npm.cmd run release:manifest
$manifest = Get-ChildItem release\candidates\*\candidate-manifest.json | Select-Object -First 1
npm.cmd run release:verify-candidate -- --manifest $manifest.FullName
```

The final command must print `ATHENA_PRIVATE_BETA_DISTRIBUTION_OK`. It verifies artifact hashes, a clean source identity, the expected publisher, timestamps and every packaged Windows executable recorded in the candidate manifest.

## 3. Installation matrix

Use a disposable Windows 10/11 VM or physical QA device. Do not run the installer matrix on the developer's primary profile.

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -File scripts\test-installer-matrix.ps1 `
  -Installer '<signed-current-installer>' `
  -PreviousInstaller '<signed-previous-installer>'
```

Archive the generated `results.json` and logs against the candidate ID. Record each environment in `docs/beta/INSTALL_MATRIX_TEMPLATE.csv`. The required set includes Windows 10 and 11, standard user and administrator/UAC paths, default and custom install locations, first install, in-place upgrade, cross-version upgrade, uninstall/reinstall, missing Ollama, Defender and Smart App Control, weak network, update pause and rollback.

## 4. Participant beta

Invite participants only after the signed candidate verification and the minimum installation matrix pass. Record consent and results in `docs/beta/PARTICIPANT_LOG_TEMPLATE.csv`; never place chat content, secrets or personal diagnostic payloads in the log.

Graduation requires 20-50 completed participants, zero open P0/P1 issues, a passed installation matrix and a candidate manifest whose `betaValidation` section records those facts. Then run:

```powershell
npm.cmd run release:verify-candidate -- --manifest '<candidate-manifest.json>' --require-graduation
```

Only `ATHENA_PRIVATE_BETA_GRADUATION_OK` permits the release owner to request the next Desktop 1.0 gate. Steam, Cloud and Mobile remain separate No-Go decisions.

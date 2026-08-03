# Desktop Direct website and release preparation

> Scope: personal website download channel for the Windows Desktop Direct build. This is separate from Microsoft Store, Steam, Cloud, iOS, and Android distribution.

## Current status

Desktop Direct remains `Blocked / No-Go` until all external release inputs are present:

- Public website pages are live and consistent with the product boundary.
- Authenticode signing identity is available in a protected build environment.
- HTTPS update origin is available for beta and stable channels.
- Signed candidate passes Athena release verification.
- Real installation matrix and 20-50 participant Beta evidence are archived.

Do not publish an unsigned `Athena Setup.exe` on the website.

## Step 1: Choose the primary domain

Selected public domain (registration confirmed on 2026-07-22):

```text
PRIMARY_DOMAIN=elanastra.com
WEBSITE_URL=https://www.elanastra.com
```

Confirmed registrar state:

- Domain status: normal.
- Registrant type: personal; real-name verification completed.
- DNS provider: DNSPod.
- Authoritative nameservers: `ship.dnspod.net`, `jeff.dnspod.net`.
- Expiration: 2027-07-22; renewal reminder and automatic renewal enabled.
- Website DNS records: not configured yet, as expected before hosting is created.
- Security action now: enable the free registrar transfer-prohibition lock.
- Security action after DNS is stable: enable the free update-prohibition lock only after CloudBase, `www`, `updates`, and filing-related DNS changes are complete.
- Optional paid registry lock: not required for the current personal-site stage.

Owner action:

- Keep `elanastra.com` as the primary domain for the Desktop Direct website.
- Use subdomains under the same domain. They do not need separate purchases.

Reserved DNS layout:

```text
elanastra.com          -> redirect to canonical website
www.elanastra.com      -> public website
updates.elanastra.com  -> Desktop Direct update/download origin
support.elanastra.com  -> support portal, optional for later
status.elanastra.com   -> status page, optional for later
```

Useful links:

- GitHub Pages custom domains: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site
- GitHub Pages HTTPS: https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https
- Cloudflare Pages custom domains: https://developers.cloudflare.com/pages/configuration/custom-domains/

Owner output to provide:

```text
PRIMARY_DOMAIN=elanastra.com
WEBSITE_URL=https://www.elanastra.com
```

## Step 2: Prepare public website pages

The website can be visually unfinished, but these URLs must exist before a public or private external download.

Required pages:

```text
/                       Product overview
/download               Private Beta download status
/privacy                Privacy policy
/terms                  Terms or EULA
/support                Support contact
/security               Security contact or vulnerability reporting
/release-notes          Changelog and known limitations
```

Download page rule:

- Before signed verification, show `Private Beta preparing`.
- Do not link to local unsigned artifacts.
- Do not collect user API keys on the website.

Suggested temporary download-page text:

```text
Athena Private Beta is preparing.
The Windows installer will be available after signed build verification.
Beta access is invitation-only while installation, update, voice, search, and model-provider flows are being validated.
```

Owner output to provide:

```text
DOWNLOAD_URL=https://www.elanastra.com/download
PRIVACY_URL=https://www.elanastra.com/privacy
TERMS_URL=https://www.elanastra.com/terms
SUPPORT_URL=https://www.elanastra.com/support
SECURITY_URL=https://www.elanastra.com/security
RELEASE_NOTES_URL=https://www.elanastra.com/release-notes
```

## Step 3: Prepare HTTPS update origin

Recommended shape:

```text
https://updates.elanastra.com/athena/win/
  channels/
    beta/
      control.json
      latest.json
      rollback.json
      candidates/
    stable/
      control.json
      latest.json
      rollback.json
      candidates/
```

Recommended hosting options:

- Cloudflare R2 public bucket with custom domain: https://developers.cloudflare.com/r2/buckets/public-buckets/
- GitHub Releases for early artifact hosting: https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository
- Amazon S3 plus CloudFront for HTTPS hosting: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/getting-started-cloudfront-overview.html

Owner output to provide:

```text
ATHENA_UPDATE_BASE_URL=https://updates.elanastra.com/athena/win
```

## Step 4: Prepare code signing identity

The Direct installer requires a trusted Windows Authenticode signature. Self-signed certificates and unsigned installers are not acceptable for public or private external Beta distribution.

Options:

- Microsoft Artifact Signing / Trusted Signing: https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart
- Artifact Signing integrations: https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations
- Traditional code-signing certificate from a Microsoft Trusted Root participant: https://learn.microsoft.com/en-us/security/trusted-root/participants-list

Secret handling rules:

- Do not commit certificates, private keys, PFX passwords, account passwords, API keys, or store tokens.
- Do not paste signing secrets into chat.
- Put signing material only in a protected local build environment or CI secret store.

Owner output to provide:

```text
ATHENA_SIGNING_PUBLISHER=
```

Protected environment variables required by Athena release scripts:

```text
CSC_LINK=<secret>
CSC_KEY_PASSWORD=<secret>
ATHENA_SIGNING_PUBLISHER=<public publisher DN or approved signer subject>
ATHENA_UPDATE_BASE_URL=https://updates.elanastra.com/athena/win
```

## Step 5: Build signed candidate

Codex action after owner supplies the public URLs and protected signing environment:

```powershell
npm.cmd run release:preflight
npm.cmd run build:release -- --require-clean
.\release\win-unpacked\Athena.exe --smoke-test
npm.cmd run release:manifest
npm.cmd run release:verify-candidate -- --manifest <candidate-manifest.json>
```

Required pass condition:

```text
ATHENA_PRIVATE_BETA_DISTRIBUTION_OK
```

If the certificate, publisher, HTTPS feed, timestamp, clean checkout, or signature checks are missing, keep the candidate `Blocked / No-Go`.

## Step 6: Stage beta update channel

Codex action after a signed candidate passes verification:

```powershell
npm.cmd run release:channel -- stage --feed <local-feed-path> --channel beta --manifest release\candidates\<candidate-id>\candidate-manifest.json
```

Then upload the staged feed directory to:

```text
ATHENA_UPDATE_BASE_URL/channels/beta/
```

Required evidence:

- Installer download works from HTTPS.
- Update metadata is reachable from HTTPS.
- Client verifies hash and signer.
- Pause and rollback commands are rehearsed against the real feed before wider Beta.

## Step 7: Run installation matrix

Use disposable Windows 10/11 devices or VMs. Do not use the developer's primary profile as the only evidence.

Record results in:

```text
docs/beta/INSTALL_MATRIX_TEMPLATE.csv
```

Required coverage:

- Windows 10 and Windows 11.
- Standard user and administrator/UAC flows.
- Default install path and custom install path.
- First install, uninstall, reinstall, and in-place upgrade.
- Missing Ollama first-run path.
- Ollama local model path.
- Custom provider/API key path.
- Voice input and voice output readiness.
- Network search consent and behavior.
- Defender and Smart App Control behavior.
- Weak network and update pause/rollback behavior.

## Step 8: Run real participant Beta

Invite participants only after signed candidate verification and the minimum installation matrix pass.

Record results in:

```text
docs/beta/PARTICIPANT_LOG_TEMPLATE.csv
```

Rules:

- Minimum 20 completed real participants before graduation.
- Do not record user chat content.
- Do not record API keys.
- Do not record personal diagnostic payloads unless explicitly consented and minimized.
- Keep issue IDs separate from private user data.

Graduation command after evidence exists:

```powershell
npm.cmd run release:verify-candidate -- --manifest <candidate-manifest.json> --require-graduation
```

Required pass condition:

```text
ATHENA_PRIVATE_BETA_GRADUATION_OK
```

## Owner handoff checklist

Fill these values when available:

```text
PRIMARY_DOMAIN=elanastra.com
WEBSITE_URL=https://www.elanastra.com
DOWNLOAD_URL=https://www.elanastra.com/download
PRIVACY_URL=https://www.elanastra.com/privacy
TERMS_URL=https://www.elanastra.com/terms
SUPPORT_URL=https://www.elanastra.com/support
SECURITY_URL=https://www.elanastra.com/security
RELEASE_NOTES_URL=https://www.elanastra.com/release-notes
ATHENA_UPDATE_BASE_URL=https://updates.elanastra.com/athena/win
ATHENA_SIGNING_PUBLISHER=
SIGNING_METHOD=
```

Do not fill these values in this document:

```text
CSC_LINK
CSC_KEY_PASSWORD
OpenAI API keys
DeepSeek API keys
Partner Center credentials
Cloudflare/AWS/GitHub tokens
```

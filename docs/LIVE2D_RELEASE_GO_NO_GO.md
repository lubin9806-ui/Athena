# Athena Live2D Release Gate

Updated: 2026-09-13

## Archived Runtime Fixture: SOURCE-ONLY GO

The retired v1 runtime remains in the repository as a development fixture. It is eligible for source-level regression testing when all of the following pass:

- `npm.cmd run test:live2d:runtime` validates the archived Cubism model, texture, motion, physics, host and controller contracts.
- PixiJS and the Live2D adapter remain development dependencies, not distributable production dependencies.
- `npm.cmd run test:live2d:desktop-pet` validates the archived source contracts and proves the release-disabled smoke does not start a desktop-pet window.

This GO is only an engineering statement about retained source fixtures. It does not enable or advertise Live2D in the current product.

## Current Release Gate: DISABLED GO

The current release is correct only while all of the following remain true:

- `RELEASE_FEATURES.live2d=false`.
- Vite does not build a Live2D entry point and prunes the complete renderer avatar tree.
- Desktop, Store and Steam builder configurations exclude avatar assets, Cubism Core, compiled avatar code, desktop-pet preload and the Live2D engine dependency.
- `npm.cmd run test:live2d:package` reports `ATHENA_LIVE2D_RELEASE_GATE_OK` and proves the packaged ASAR contains none of those disabled artifacts.

## Athena Default Character: NO-GO

The previous `athena-live2d-default` visual direction is retired as of 2026-08-23. It remains a technical archive and regression fixture, not the product default.

`live2d-official-haru` is a temporary official sample reference for Cubism runtime validation. It must not be treated as Athena's identity or a public product asset.

The next default character must follow `docs/LIVE2D_RESTART_V2.md`, use a genuine reviewed Cubism export, and pass a new visual quality gate before the release flag can change.

## Public Distribution: NO-GO

Public, Store, Steam, marketplace, or paid distribution is blocked until:

- Live2D confirms whether Athena is an Expandable Application and the required Publication License Agreement is completed.
- The project owner records acceptance of the applicable Cubism software licenses and retains the original SDK download evidence.
- A human completes rights and originality review for the AI-generated character and the user-supplied photo references.
- Publisher identity, Athena/Su Shixia trademark review, signing, and production update-feed gates pass.

Official references:

- https://www.live2d.com/en/sdk/license/
- https://www.live2d.com/en/sdk/license/expandable/
- https://www.live2d.com/en/sdk/download/web/

## Model Quality Boundary

The archived v1 Athena character is a functional automatic baseline: it has a genuine Cubism export, expressions, motion files, physics, real-time lip sync, hot-zone interaction, and four selectable placements. It is not an acceptable default character direction. Independent arm deformation, model-native hit areas, broader face and hair polish, and the overall visual identity remain future v2 art-production work.

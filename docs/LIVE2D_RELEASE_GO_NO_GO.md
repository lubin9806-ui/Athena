# Athena Live2D Release Gate

Date: 2026-08-23

## Engineering Package: GO

The Windows engineering package is eligible for local validation when all of the following pass:

- Vite output contains the Cubism model, texture, physics, expressions, motions, Cubism Core, pet HTML, and dedicated preload.
- Vite output and ASAR exclude PSDs, generated layer sources, rigging notes, the retired 3D prototype, and duplicate raw avatar directories.
- The packaged application passes the Live2D desktop-pet smoke test with the `cubism-web` engine.
- `npm.cmd run test:live2d:package` reports `ATHENA_LIVE2D_PACKAGE_OK`.

This GO is an engineering statement only. It does not authorize public distribution.

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

The bundled character is a functional automatic baseline: it has a genuine Cubism export, expressions, motion files, physics, real-time lip sync, hot-zone interaction, and four selectable placements. It is not yet equivalent to a senior human rigger's final commercial model. Independent arm deformation, model-native hit areas, and broader face and hair polish remain future art-production work.

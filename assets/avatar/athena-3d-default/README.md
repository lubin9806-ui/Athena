# Athena 3D Default Avatar

This folder contains Athena's first runnable 3D avatar asset.

Current status: runnable GLB placeholder, not a humanoid VRM rig.

## Files

- `model/athena-3d-default.glb`: generated stylized 3D character exported from Blender.
- `manifest.json`: runtime metadata and upgrade notes.

## Runtime Target

The GLB is intended for Athena's Three.js avatar adapter. It is a practical desktop-pet asset that can support:

- scene rendering
- pointer tracking through object rotation
- simple expression/material swaps in later stages
- lip-sync placeholder through mouth object scaling or material visibility
- hot-zone targeting through named objects and empties

It is not yet a full VRM humanoid with standardized bones, expressions, look-at, or spring bones. A future `.vrm` asset can replace this GLB while keeping the same AvatarRuntime contract.


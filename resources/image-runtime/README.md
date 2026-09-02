# Athena local image runtime

This directory contains Athena's managed standalone `stable-diffusion.cpp`
`sd-cli.exe` runtime. It complements the separately supported ComfyUI route:
users may choose either engine, or let Athena auto-connect to an available one.
The settings UI can install a pinned CUDA, Vulkan, or CPU build on demand. Athena
verifies the archive size and SHA-256 before extraction and records the installed
executable hash before reusing it.

The executable is intentionally not committed in this source checkout. A release
that advertises turnkey local generation must place a reviewed Windows build at
`resources/image-runtime/sd-cli.exe`, record its lowercase SHA-256 as
`bundledExecutableSha256` in `runtime-manifest.json`, and pass:

```powershell
npm.cmd run release:image-runtime-preflight
```

Model weights are not embedded by this contract. Users can select a local
`.safetensors`, `.gguf`, `.ckpt`, `.pth`, or `.pt` file in Athena settings. Model
licensing and redistribution approval remain separate release requirements.

The normal lightweight package may omit `sd-cli.exe`. It still ships this
manifest and lets users install a pinned CUDA, Vulkan, or CPU runtime from the
settings UI without installing ComfyUI. Package verification treats that shape
as `on-demand`; it rejects an unpinned executable if one appears in the package.

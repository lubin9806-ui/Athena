---
name: reference-image-editing
description: Edit, restyle, preserve, or combine images attached to the current execution chat using the governed OpenAI image edit artifact tool.
license: Apache-2.0
compatibility: Athena Desktop 0.9.5+
allowed-tools: edit_image_artifact
metadata:
  version: 1.0.0
---
# Reference Image Editing

Use this skill when the user wants an existing attached image changed or multiple attached references combined.

1. Identify the exact managed attachment IDs from the current execution context. Never invent paths or IDs.
2. Translate the request into one precise edit prompt that names what must change and what must remain unchanged.
3. Use a mask only when the user supplied a separate PNG alpha mask matching the first PNG reference image.
4. Explain through the approval surface that the prompt, selected references, and optional mask leave the device and may incur API charges.
5. Call `edit_image_artifact` once per approved output. Do not silently retry moderation or user-correctable failures.
6. Report the saved artifact and distinguish generated output from the source images.

For `gpt-image-2`, do not request an `input_fidelity` override; input references are handled at high fidelity by the provider.

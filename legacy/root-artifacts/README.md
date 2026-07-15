# Preserved root artifacts

Window 01 moved 17 files out of the repository root on 2026-07-15 because they were clearly generated voice probes, download output, an archive, or a Windows shortcut. Nothing was deleted.

The original filename, size and SHA-256 are recorded in `MANIFEST.sha256`. Binary payloads are stored under `preserved-files/` and intentionally ignored by Git. The 758 MB `public.zip` is retained because its origin is unknown and it may contain historical source material.

The following were deliberately not touched:

- `新建文件夹/`, `.agents/` and `.codex/`, because their provenance is unknown even though they were empty at audit time.
- `models/` and `resources/OllamaSetup.exe`, because they are local runtime/distribution inputs.
- root Python and launcher scripts, because they are active packaging/runtime inputs.

Do not delete these preserved files until a later issue explicitly establishes ownership, retention period and a verified backup.


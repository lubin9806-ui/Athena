# Steam redistributables

Athena Steam 1.0 targets Windows x64 only.

- The Steamworks native bridge packages `steam_api64.dll` beside its unpacked native module. The build verifier requires both files.
- `steamworksjs.win32-x64-msvc.node` imports `vcruntime140.dll` and Universal CRT API sets. Enable Steamworks **Microsoft Visual C++ Redistributable 2015–2022 (x64)** for the AppID before clean-machine testing.
- Do not add a custom first-run installer unless a clean Windows test proves another prerequisite is necessary. Steam common redistributables are preferred.
- Ollama and model files are not redistributables and are not copied into the Steam depot by this configuration.

The Steamworks partner setting and clean-machine result cannot be verified without the real partner account and AppID, so they remain Blocked in this repository.

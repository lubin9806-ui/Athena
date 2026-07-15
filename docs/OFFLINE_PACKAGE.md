# Athena Offline Pack

This folder contains the Athena installer, the Ollama installer, and a bundled Ollama model store with `qwen2.5:14b`.

## Install

Double-click `START_HERE.bat`.

The script will:

1. install Ollama if it is not already installed
2. copy the bundled model files into `%USERPROFILE%\.ollama\models`
3. start Ollama
4. verify that `qwen2.5:14b` is available
5. run the Athena installer
6. launch Athena when the default install path is found

## Notes

- The model files are large, so copying can take several minutes.
- Existing Ollama models are preserved.
- Athena expects Ollama at `http://127.0.0.1:11434` and the default model `qwen2.5:14b`.
- If Windows blocks the scripts, right-click `START_HERE.bat`, choose Properties, and unblock it.

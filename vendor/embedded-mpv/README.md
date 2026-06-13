# Embedded MPV Runtime Artifacts

This directory is the staging location for generated embedded MPV runtime/build
artifacts.

Generated architecture folders are expected at:

- `vendor/embedded-mpv/darwin-arm64/`
- `vendor/embedded-mpv/darwin-x64/`
- `vendor/embedded-mpv/win32-x64/`
- `vendor/embedded-mpv/linux-x64/`

Each generated folder must contain `include/mpv/client.h` and
`runtime-manifest.json`. macOS and Windows folders also contain platform
runtime/build inputs under `lib/` or `bin/`. The binary runtime directories are
ignored by git by default; generate, stage, or restore them in release packaging
jobs before building the Electron backend.

Linux uses this directory for MPV headers and build metadata only. Linux
packages launch the system `mpv` executable and must not bundle `libmpv.so`.

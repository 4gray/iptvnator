# Embedded MPV Runtime Artifacts

This directory is the staging location for generated embedded MPV runtime/build
artifacts.

Generated architecture folders are expected at:

- `vendor/embedded-mpv/darwin-arm64/`
- `vendor/embedded-mpv/darwin-x64/`
- `vendor/embedded-mpv/win32-x64/`
- `vendor/embedded-mpv/linux-x64/`

Each generated folder must contain `include/mpv/client.h` and
`runtime-manifest.json`. Platform runtime/build inputs live under `lib/` or
`bin/`. In particular, `linux-x64/lib/` contains the pinned, dynamically linked
LGPL-compatible libmpv closure used to link the out-of-process frame-copy
helper. The binary runtime directories are ignored by git; generate, stage, or
restore them before building the Electron backend.

Linux package profiles consume that one staged x64 source runtime differently:

- DEB/RPM/Pacman remove the private closure and declare the system libmpv
  dependency.
- AppImage/Snap/Flatpak retain the manifest-declared closure under
  `app.asar.unpacked/electron-backend/native/lib/`.
- Non-x64 Linux packages retain no native artifacts and ship only the
  unavailable marker.

Only `iptvnator_mpv_helper` may link libmpv. Electron,
`embedded_mpv.node`, and `embedded_mpv_frame_reader.node` must remain free of
direct libmpv dependencies. See `tools/embedded-mpv/README.md` and
`docs/architecture/embedded-mpv-native.md`.

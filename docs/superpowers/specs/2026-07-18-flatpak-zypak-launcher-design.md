# Flatpak Zypak Launcher Design

## Goal

Package Flatpak so Electron Builder's generated `electron-wrapper` passes the
real IPTVnator ELF executable directly to Zypak. Preserve the existing
conditional Linux sandbox wrapper for AppImage, DEB, RPM, Pacman, and Snap.

## Root Cause

The common Linux `afterPack` hook currently renames the Electron executable
from `iptvnator` to `iptvnator.bin` and writes a shell script at `iptvnator`.
Electron Builder's Flatpak launcher calls `zypak-wrapper iptvnator`, so Zypak
receives the shell script instead of an ELF executable. Zypak rejects that
layout; the shell script can then mask the failure by adding `--no-sandbox` on
hosts with restricted user namespaces.

## Launcher Contract

Introduce one packaging-owned launcher-layout helper:

- an isolated Flatpak target uses `iptvnator` as the Electron ELF and does not
  apply the custom Linux sandbox wrapper;
- every other supported Linux target keeps the existing `iptvnator` shell
  wrapper and `iptvnator.bin` Electron ELF;
- a target set containing Flatpak and any other target fails before filesystem
  mutation because Electron Builder shares one unpacked application tree
  across those targets;
- target matching is case-insensitive and uses Electron Builder's documented
  `AfterPackContext.targets[].name` values, not output paths or environment
  heuristics.

The launcher hook, pristine-layout validation, and extracted-artifact
validation must all resolve the Electron ELF path through this contract.

## Validation

Regression coverage will prove the following:

1. The Linux launcher hook preserves the original executable bytes and creates
   no `.bin` file for an isolated Flatpak target.
2. The hook retains the existing wrapper layout for a non-Flatpak Linux target.
3. A mixed Flatpak/non-Flatpak target set fails before renaming the executable.
4. Pristine Flatpak validation inspects `iptvnator`, while other profiles
   inspect `iptvnator.bin`.
5. Extracted Flatpak verification reads architecture and checks process
   isolation from `iptvnator`.
6. CI asserts that the installed Flatpak target is an ELF, rejects a sibling
   `.bin` layout, and fails on the known Zypak wrapper warnings.

The existing application-level `--embedded-mpv-runtime-probe` remains the
sandboxed launch check. Once the custom wrapper is absent, it can no longer
silently add `--no-sandbox`; reaching the Electron main-process probe therefore
also verifies the corrected Zypak entry path.

## Documentation

Update the canonical Linux Embedded MPV packaging documentation and the living
`AGENTS.md`/`CLAUDE.md` summaries to state the launcher split explicitly.
Correct the earlier Linux frame-copy design document's claim that every Linux
Electron executable is named `iptvnator.bin`.

## Non-Goals

- Changing the Chromium GPU/Video.js behavior reported in issue #1203.
- Removing the conditional sandbox wrapper from non-Flatpak Linux packages.
- Adding `--no-sandbox`, changing `chrome-sandbox` permissions, or bypassing
  Zypak.
- Changing the bundled Embedded MPV runtime or Flatpak permissions.

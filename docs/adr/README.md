# Architecture Decision Records

This directory holds [MADR](https://adr.github.io/madr/)-format Architecture
Decision Records. Each ADR captures one decision: its context, the options
considered, the outcome, and the consequences.

**Status values:** `proposed` → `accepted` → `rejected` / `deprecated` /
`superseded by NNNN`. The status is in each file's front matter and (for proposed
work) a banner at the top.

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](./0001-unified-player-controls-contract.md) | Unified, engine-agnostic player-controls contract | Proposed |
| [0002](./0002-embedded-mpv-immersive-compositing.md) | Embedded-MPV immersive overlay compositing | Proposed |
| [0003](./0003-macos-native-fullscreen-embedded-mpv.md) | Real macOS native fullscreen for embedded MPV | Proposed |

ADRs 0001–0003 describe a single proposed direction (a unified player-controls
architecture) implemented on a separate branch and
**not yet on `master`**. The implementation — full contract API, adapters,
native compositing, and tests — lives on that branch and is demonstrated in the
proposal video.

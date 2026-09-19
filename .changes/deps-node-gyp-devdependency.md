---
type: internal
area: deps
---

The Embedded MPV native addon build now declares its `node-gyp` dependency
explicitly, so `node apps/electron-backend/build-embedded-mpv.js` and the
Homebrew development scripts work on a clean checkout instead of failing with
"Unable to resolve node-gyp". Packaged builds are unchanged.

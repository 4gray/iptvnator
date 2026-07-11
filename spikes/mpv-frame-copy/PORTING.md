# Frame-copy engine — Windows/Linux porting handoff

> Handoff for future Claude/dev sessions on Windows and Linux machines
> (they won't have the originating Mac's local session memory — this file
> is the transfer). Written 2026-07-11 by the macOS session that built the
> engine; fold into DESIGN.md once both ports land.

## State as of this handoff

- Branch: `claude/embedded-mpv-frame-copy-6ddc36`, PR:
  https://github.com/4gray/iptvnator/pull/1169 (CI fully green).
- The engine works end-to-end on macOS Apple Silicon: Settings toggle →
  restart → helper process renders mpv offscreen → shm ring → preload pump
  → WebGL canvas. Verified live with real IPTV + Stalker VOD.
- Scope decision: macOS = arm64 only (Intel Macs keep the native engine).
- **UPDATE 2026-07-11: the Linux port below is DONE** (branch
  `claude/linux-frame-copy-port-0a871b`, stacked PR on #1169) — headless
  EGL helper, portable clock, reader on `__linux__`, TS gates, i18n,
  measurements in RESULTS.md. Verified end-to-end in-app on Ubuntu 25.04
  (Wayland session) with the xtream mock portal. Dev-build-only on Linux:
  the helper links system libmpv and `electron-after-pack.cjs` strips it
  from packages until milestone 4 (Linux bundled-libmpv runtime) — remove
  that strip when milestone 4 lands. Windows is NOT ported yet — this branch on
  Windows behaves exactly like master (helper doesn't build there, engine
  can't activate, env flag falls back to native).
- Coordination: PR #1169 credits larsemig's idea (#1154 comment 4932807350)
  and proposes the series merge plan: merge the shared-controls subset
  (#1148/#1149/#1152–54) rebased, supersede immersive (#1150/#1151) with
  this engine. **Do not touch the controls layer** until that lands.

## What "porting" means

Only the helper (and a small reader-addon branch) is platform-specific.
The stdio protocol, shm layout, TS adapter, main-process service, preload
pump, and Angular UI are shared and already shipped.

```
apps/electron-backend/native/helper/          # state after the Linux port:
├── mpv_frame_helper.cpp     # portable: protocol, mpv session, snapshots
├── frame_helper_io.h        # portable: TSV-in/JSON-out, percent-encoding
├── frame_shm.h              # portable layout + shared CLOCK_MONOTONIC clock
│                            # (POSIX shm calls still need a Windows twin)
├── frame_helper_render.h    # portable: FBO/PBO readback + shm publish
└── frame_helper_gl.h        # PLATFORM SEAM: GlContext — CGL (macOS) and
                             # EGL (Linux); Windows adds its WGL twin HERE
apps/electron-backend/native/src/embedded_mpv_frame_reader.c
                             # real impl on __APPLE__ + __linux__, stub
                             # elsewhere (Windows needs shm-open/clock twins)
```

Porting Windows = give `frame_helper_gl.h` a WGL GlContext twin, give the
shm create/open (+ `frame_shm_now_ns`) Windows twins, flip the TS gate in
`embedded-mpv-frame-copy-platform.util.ts`, extend packaging.

## Branching & merge strategy (do this, not "commit to the current branch")

- **Never commit port work into `claude/embedded-mpv-frame-copy-6ddc36`** —
  that branch backs PR #1169, which is a frozen review/testing target
  (review fixes only).
- Create a port branch off it: `claude/frame-copy-linux-port` (Windows
  later: branch off the Linux port branch if it reuses its portable
  clock/shm refactors — likely yes — otherwise off the frame-copy branch).
- Open the port PR with **base = the frame-copy branch**, so the diff shows
  only the port. Merge order: #1169 → Linux PR → Windows PR. When #1169
  merges and its branch is deleted, GitHub retargets the stacked PR to
  master automatically.
- Keep the stack at most one unmerged level deep; if #1169 gains review
  commits, rebase the port branch onto it early and often.
- Commit incrementally within the port branch; land each platform's
  measurement rows in `RESULTS.md` in the same PR as its port.
- If #1169 has already merged by the time you read this: branch off
  `master` instead and ignore the retargeting notes.

## Per-platform task lists

### Linux (DONE 2026-07-11 — see the update in "State" above)

1. **Render backend**: headless EGL (`EGL_PLATFORM_SURFACELESS_MESA` /
   `eglGetPlatformDisplay(EGL_PLATFORM_SURFACELESS_MESA)` with fallback to
   GBM) + the same FBO/PBO/readback code. GL entry points via
   `eglGetProcAddress` in mpv's `get_proc_address`.
2. **shm**: POSIX `shm_open` works as-is. The ONLY blocker in shared code:
   `clock_gettime_nsec_np(CLOCK_MONOTONIC_RAW)` is **macOS-only** — replace
   with a portable `now_ns()` (`clock_gettime(CLOCK_MONOTONIC, ...)`) in
   `frame_helper_render.h`, `frame_shm` users, and the reader addon. Keep
   producer/consumer on the SAME clock.
3. **Reader addon**: change `#ifdef __APPLE__` to also cover `__linux__`
   (code is already POSIX apart from the clock call).
4. **binding.gyp**: helper target gets a linux branch — link system libmpv
   for dev first (`-lmpv`); bundled-libmpv runtime is a later packaging
   task. NOTE: the LINUX ADDON must still not link libmpv (that rule is for
   in-process only — the helper is a separate process, linking is the whole
   point and is legal there).
5. **TS gates**: `isFrameCopyEngineActive`/`isFrameCopyAvailable` in
   `embedded-mpv-native.service.ts` (drop the darwin/arm64-only condition
   for linux), `EmbeddedMpvFrameCopyAdapter.isSupported`, Settings copy +
   i18n descriptions currently say "macOS Apple Silicon only".
6. **Big prize**: no window embedding → native Wayland just works; later
   bundle libmpv → no system-mpv-on-PATH requirement → Flatpak/Snap. Update
   the Linux support matrix in `docs/architecture/embedded-mpv-native.md`
   when this lands.

### Windows

1. **Render backend**: WGL headless — create a hidden message-only window +
   dummy pixel format, `wglCreateContextAttribsARB` 3.2 core, then the same
   FBO/PBO path. `MPV_RENDER_API_TYPE_SW` is the fallback bring-up if WGL
   fights (CPU render, still proves the pipeline).
2. **shm**: `CreateFileMapping(INVALID_HANDLE_VALUE, ...)` +
   `MapViewOfFile` behind the same `FrameShmHeader` layout. Name mapping:
   `Local\\impv-...` (session-local namespace). Reader addon gets the
   `#ifdef _WIN32` twin. Atomics: `std::atomic<uint64_t>` fine with MSVC;
   the C reader can use `InterlockedCompareExchange`-free plain
   `_Atomic`-equivalent via C11 `<stdatomic.h>` (clang-cl) or volatile+
   `MemoryBarrier` — simplest is compiling the reader as C++ on Windows.
3. **Process control**: `child.kill('SIGTERM')` on Windows is
   TerminateProcess (no graceful signal) — the quit command + stdin-EOF
   paths (already implemented) are the graceful route; keep the kill as the
   hard fallback. stdio pipes work unchanged.
4. **binding.gyp**: helper `.exe` target under `OS=="win"` linking the
   existing import lib (`LIBMPV_IMPORT_LIB` env — see build-embedded-mpv.js
   Windows path). DLL resolution: the helper exe sits next to `lib/` with
   the mpv DLL — either copy the DLL beside the exe at build time or call
   `SetDllDirectory`/`AddDllDirectory` at startup. Watch the documented
   import-library-vs-DLL-basename gotcha (embedded-mpv-native.md).
5. **TS gates + audio**: same switches as Linux. WASAPI audio comes from
   mpv directly — nothing to do.
6. **This is the open PERFORMANCE gate**: mid-range iGPU laptop numbers
   decide go/no-go (RESULTS.md has the methodology + reference M1 numbers:
   4K60 sustained, ~10 ms produce→upload, zero torn frames).

### Both platforms — shared chores

- `validatePackagedEmbeddedMpv` in `tools/packaging/embedded-mpv-packaging.cjs`
  currently requires frame-copy artifacts **on darwin only** — extend per
  platform when artifacts ship. Keep tests host-agnostic (CI runs them on
  a Linux runner; asserting an empty error list for a darwin dir fails
  there with "link validation must run on a macOS host" — already fixed
  once, don't regress).
- `getMainWindowScaleFactor` (Electron `screen`) is cross-platform — no
  work needed; the helper receives device pixels.
- Sandbox story: the flag relaxes the BrowserWindow sandbox for the preload
  reader require. Same trade-off applies on Win/Linux. Revisit-before-
  default-on candidates are in the architecture doc.

## Hard-won gotchas (do not rediscover these)

1. **Preload + tslib**: repo tsconfig has `target: es2015`; ANY construct
   that emits TS helpers in preload code (async/await, object spread in
   downlevel positions) with `importHelpers: true` makes webpack
   externalize `tslib` → the sandboxed preload dies with
   `module not found: tslib` → `window.electron` disappears app-wide.
   `apps/electron-backend/tsconfig.app.json` now sets
   `importHelpers: false` — NEVER revert it. Symptom to recognize:
   "Unable to load preload script" in renderer console.
2. **V8 memory cage**: `napi_create_external_arraybuffer` over shm aborts
   in Electron. The reader MUST memcpy into a V8 buffer. Budgeted (~1.2 ms
   at 4K).
3. **Frame orientation**: helper renders with `MPV_RENDER_PARAM_FLIP_Y=1`
   and `glReadPixels` reads rows bottom-up → the shm buffer is already in
   texture order. The pump shader samples with UN-flipped uv. Adding a
   second flip shows upside-down video (bug already made and fixed once).
4. **BGRA fast path**: readback as `GL_BGRA`/`GL_UNSIGNED_INT_8_8_8_8_REV`,
   upload as RGBA, swizzle `.bgr` in the fragment shader. On Windows check
   whether BGRA readback stays the fast path per driver; measure, don't
   assume.
5. **Aspect**: mpv reports unset `video-aspect-override` as `"-1.000000"`
   → normalize to `"no"`. The helper aspect-fits the FBO to
   `dwidth`/`dheight` inside the viewport (no baked letterbox bars) and
   bumps a shm generation (`<base>-g<N>`) on every size change; the pump
   re-attaches via the FRAME_SOURCE_CHANGED event.
6. **Stale attach race**: attach/detach bump a shared epoch in the pump;
   every await re-checks it. Keep that invariant if touching the pump.
7. **Lifecycle**: dispose escalation is quit-command → stdin.end() (helper
   exits on EOF) → SIGTERM(500 ms) → SIGKILL(2 s). The SERVICE also reaps
   all sessions on `render-process-gone`/`did-navigate` (renderer crash or
   hard reload never runs Angular teardown — without this, helpers leak).
   Watch `ps | grep iptvnator_mpv_helper` during any manual test session.
8. **Stale opt-in**: `isFrameCopyEngineActive()` requires the helper binary
   on disk; missing helper = silent fallback to native, and the Settings
   checkbox stays visible while the saved value is true so it can always
   be cleared.
9. **node-gyp naming**: module targets emit `<target_name>.node` (no
   `product_name` needed); the helper uses the `"type": "none"` default +
   per-OS `"type": "executable"` override trick in binding.gyp.
10. **snapshot protocol**: helper's `snapshot` JSON mirrors
    `NativeEmbeddedMpvSessionSnapshot` verbatim (volume 0..1, `null`able
    duration/track ids, `videoWidth/videoHeight` when known). Status
    semantics are ported from `embedded_mpv.mm` — END_FILE reason mapping,
    `eof-reached` ⇒ `ended` (keep-open), pause gated on loadedPath,
    only fatal/load errors flip status. Don't invent new mappings.

## Testing recipes

- **Helper standalone** (no Electron):
  `(printf 'load\turl=av://lavfi:testsrc2=size=640x360:rate=30\n'; sleep 5; printf 'quit\n') | ./iptvnator_mpv_helper --shm-base /impv-t --width 1280 --height 720`
  → expect `shm` generations, `snapshot` events at 4 Hz, aspect-fit
  generation after video loads.
- **Reader probe** (any Node ≥18):
  `node -e "const r=require('.../embedded_mpv_frame_reader.node'); const i=r.open('/impv-t-g2'); ..."`
  → `latestSeq()` advancing + pixel min/max spread.
- **In-app**: `IPTVNATOR_ENABLE_EMBEDDED_MPV_FRAME_COPY=1 pnpm run
  serve:backend:embedded-mpv` or the Settings toggle (+restart). Second
  parallel instance for CDP testing: build, then run
  `electron dist/apps/electron-backend/main.js --remote-debugging-port=9223
  --user-data-dir=/tmp/x` with `ELECTRON_IS_DEV=0` for the file:// renderer
  (dist package.json has no `main` field — point at main.js explicitly;
  a separate user-data-dir avoids the Chromium profile singleton).
- **Perf gate**: follow `RESULTS.md` methodology (STATS/LONGRUN lines,
  present-interval sd/p99/late counters). Reference: M1 Pro tables therein.
  The spike harness in this directory is macOS-only; for Windows/Linux
  measure through the real app + helper stderr or port collect-results.sh.

## Suggested milestone order

1. Linux helper bring-up (EGL + portable clock) → lavfi smoke → in-app
   behind flag → measure.
2. Windows helper bring-up (WGL, named shm, reader twin) → same ladder →
   **iGPU laptop numbers = the decisive open gate**.
3. Packaging: per-platform artifact validation + runtime staging.
4. Only then: revisit Linux bundled-libmpv + Flatpak/Snap story.

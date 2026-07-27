// Shared bounds for `iptvnator_mpv_helper --runtime-probe`.
//
// The two timeouts differ on purpose, because the two callers pay different
// costs for waiting:
//
// - RUNTIME_PROBE_TIMEOUT_MS bounds the application's own startup capability
//   decision, a blocking spawnSync on the Electron main process. A hung helper
//   must not stall window creation, and a timeout there degrades gracefully to
//   the native-view fallback, so this budget stays short.
// - PACKAGE_VERIFICATION_PROBE_TIMEOUT_MS bounds the one-shot packaging check
//   in tools/packaging/verify-linux-frame-copy-runtime.mjs. Nothing waits on it
//   but CI, which already has its own job-level bound, while a premature
//   timeout produces a false "broken payload" verdict on a healthy package.
//   Cold sandboxes — Flatpak most of all — spend seconds just loading libmpv
//   plus the EGL/GL/GBM stack, so this budget is generous.
//
// A hard timeout is also the one probe outcome that says nothing about the
// payload, so the packaging verifier repeats it up to
// PACKAGE_VERIFICATION_PROBE_MAX_ATTEMPTS times. Every other outcome — spawn
// error, signal, nonzero exit, malformed protocol line — remains fail-closed on
// the first attempt, and a helper that genuinely hangs still fails the check.
const RUNTIME_PROBE_CONTRACT = Object.freeze({
    RUNTIME_PROBE_MAX_BUFFER_BYTES: 16 * 1024 * 1024,
    RUNTIME_PROBE_TIMEOUT_MS: 3000,
    PACKAGE_VERIFICATION_PROBE_TIMEOUT_MS: 15000,
    PACKAGE_VERIFICATION_PROBE_MAX_ATTEMPTS: 2,
});

module.exports = RUNTIME_PROBE_CONTRACT;

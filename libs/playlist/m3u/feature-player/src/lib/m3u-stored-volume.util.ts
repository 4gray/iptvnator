/**
 * Shared `volume` bus the player engines and the audio player persist to.
 *
 * The empty cases must be rejected BEFORE `Number()` sees them: it maps both
 * `null` (nothing stored yet) and `''` to 0, which would silently start every
 * first-run playback muted.
 */
export function readStoredM3uVolume(): number {
    const stored = localStorage.getItem('volume')?.trim();
    if (!stored) {
        return 1;
    }

    const parsed = Number(stored);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 1;
}

import type { ShakaPlayerLike } from './shaka-module.types';

/**
 * Remembers the text track hidden while the captions preference is off so it
 * can be reselected when the preference turns back on — Shaka 5 has no
 * separate visibility API (selecting a track shows it, `null` hides text).
 */
export class ShakaTextTrackSuppression {
    private suppressedTrackId: number | null = null;

    /** Hides the active text track, remembering it for {@link restore}. */
    suppress(player: ShakaPlayerLike): void {
        const active = player
            .getTextTracks()
            .find((candidate) => candidate.active);
        if (!active) {
            return;
        }

        this.suppressedTrackId = active.id;
        player.selectTextTrack(null);
    }

    /** One-shot reselection of the previously suppressed track. */
    restore(player: ShakaPlayerLike): void {
        if (this.suppressedTrackId === null) {
            return;
        }

        const track = player
            .getTextTracks()
            .find((candidate) => candidate.id === this.suppressedTrackId);
        this.suppressedTrackId = null;
        if (track && !track.active) {
            player.selectTextTrack(track);
        }
    }

    reset(): void {
        this.suppressedTrackId = null;
    }
}

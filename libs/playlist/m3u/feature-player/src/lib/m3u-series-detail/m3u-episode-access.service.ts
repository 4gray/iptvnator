import { Injectable, inject } from '@angular/core';
import { PlaybackHistoryGate } from '@iptvnator/playback/data-access';
import { ParentalLockService } from '@iptvnator/services';
import { Channel } from '@iptvnator/shared/interfaces';
import { M3uRecentlyViewedRecorder } from '../m3u-recently-viewed.recorder';

/**
 * What the Series page needs from the app-wide playback rules before and
 * after it plays an episode itself.
 *
 * The channel player gets both for free: the parental-lock enforcement and
 * the Recently-viewed effect watch the store's active channel. The Series
 * page plays from its own state (inline) or hands the row to MPV/VLC, so
 * neither sees it; this applies the same two rules to its episodes.
 */
@Injectable()
export class M3uEpisodeAccessService {
    private readonly parentalLock = inject(ParentalLockService);
    private readonly historyGate = inject(PlaybackHistoryGate);
    private readonly recentlyViewed = inject(M3uRecentlyViewedRecorder);

    /** Moves on every lock, unlock and relock. */
    readonly lockVersion = this.parentalLock.version;

    /** Whether the lock withholds this row's group right now. */
    isWithheld(playlistId: string, channel: Channel): boolean {
        return this.parentalLock.isM3uGroupLocked(
            playlistId,
            channel.group?.title ?? ''
        );
    }

    /**
     * Asks for the PIN for a withheld row. Resolves true when the row may
     * play afterwards; concurrent requests share the one prompt.
     */
    async requestAccess(
        playlistId: string,
        channel: Channel
    ): Promise<boolean> {
        await this.parentalLock.requestUnlock();
        return !this.isWithheld(playlistId, channel);
    }

    /**
     * Records the row in Recently viewed once it has really played: inline
     * by `sessionKey`, through the player's progress confirmation; an
     * external player by URL, through its session updates. A launch that
     * fails never reaches history, as on the channel player.
     */
    recordWhenPlayed(
        playlistId: string,
        channel: Channel,
        sessionKey: string | null
    ): void {
        this.historyGate.defer(
            { sourceId: playlistId, sessionKey, streamUrls: [channel.url] },
            () => void this.recentlyViewed.persist(playlistId, channel)
        );
    }
}

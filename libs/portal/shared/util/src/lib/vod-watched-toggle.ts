import { Signal, computed, signal } from '@angular/core';
import { PlaybackPositionData } from '@iptvnator/shared/interfaces';
import type { Logger } from './logger';
import {
    PortalPlaybackPositions,
    isPortalPlaybackWatched,
} from './portal-playback-positions';
import { buildWatchedVodPosition } from './portal-watch-state';

export type VodWatchedToggleFeedback = 'marked' | 'unmarked' | 'failed';

export interface VodWatchedToggleTarget {
    playlistId: string;
    contentXtreamId: number;
    /** Runtime the detail view knows; the stored row's duration wins over it. */
    durationSeconds?: number | null;
    /**
     * Whether the page still shows this movie once the write returns. Detail
     * hosts are reused across navigations and ids collide across playlists,
     * so a late completion must neither patch the next movie's row nor show
     * its feedback there. The write itself is safe: it carries its own ids.
     */
    stillCurrent: () => boolean;
}

export interface VodWatchedToggleConfig {
    playbackPositions: Pick<
        PortalPlaybackPositions,
        'savePlaybackPositionOrThrow' | 'clearPlaybackPositionOrThrow'
    >;
    /** The movie's row as the page shows it. */
    position: Signal<PlaybackPositionData | null>;
    /** Replaces that row after a confirmed write. */
    applyPosition: (position: PlaybackPositionData | null) => void;
    /**
     * Playback whose next position tick would overwrite a just-written row
     * (inline player mounted, external session live or launching). While it
     * is true the toggle stays disabled rather than silently flipping back.
     */
    playingNow?: Signal<boolean>;
    /**
     * Whether `position` is the stored row rather than a placeholder: until
     * the host's read lands the button would offer the wrong direction
     * (re-marking a watched movie, or clearing a row it never saw).
     */
    positionReady?: Signal<boolean>;
    notify: (feedback: VodWatchedToggleFeedback) => void;
    /**
     * Runs after a confirmed write, e.g. to refresh catalog badges. Its
     * failure is logged and swallowed: the mutation it follows is already
     * confirmed, so it must neither reject the toggle nor escape unhandled.
     */
    onPersisted?: (playlistId: string) => void | Promise<void>;
    logger?: Pick<Logger, 'error'>;
}

export interface VodWatchedToggle {
    isWatched: Signal<boolean>;
    busy: Signal<boolean>;
    enabled: Signal<boolean>;
    /** Resolves true when the write landed, false when nothing changed. */
    toggle(target: VodWatchedToggleTarget): Promise<boolean>;
}

/**
 * Manual "watched" toggle for a movie, shared by the Xtream and Stalker
 * detail views. Marking writes a full-progress position row (the same shape
 * playback itself leaves behind, so every catalog badge and Resume rule keeps
 * working unchanged); unmarking deletes the row, which also forgets the
 * resume point — the same trade the episode toggle makes.
 *
 * Both writes go through the strict, rejecting persistence boundary: the
 * row on screen changes only after the write is confirmed, never before.
 */
export function createVodWatchedToggle(
    config: VodWatchedToggleConfig
): VodWatchedToggle {
    const busy = signal(false);
    const isWatched = computed(() =>
        isPortalPlaybackWatched(config.position())
    );
    const enabled = computed(
        () =>
            !busy() &&
            !(config.playingNow?.() ?? false) &&
            (config.positionReady?.() ?? true)
    );

    async function toggle(target: VodWatchedToggleTarget): Promise<boolean> {
        if (!enabled() || !target.playlistId) {
            return false;
        }

        const markWatched = !isWatched();
        busy.set(true);
        try {
            let next: PlaybackPositionData | null = null;
            if (markWatched) {
                next = buildWatchedVodPosition({
                    playlistId: target.playlistId,
                    contentXtreamId: target.contentXtreamId,
                    durationSeconds: target.durationSeconds,
                    currentPosition: config.position(),
                });
                await config.playbackPositions.savePlaybackPositionOrThrow(
                    target.playlistId,
                    next
                );
            } else {
                await config.playbackPositions.clearPlaybackPositionOrThrow(
                    target.playlistId,
                    target.contentXtreamId,
                    'vod'
                );
            }

            void Promise.resolve()
                .then(() => config.onPersisted?.(target.playlistId))
                .catch((error) =>
                    config.logger?.error(
                        'Refresh after watched toggle failed',
                        error
                    )
                );
            if (!target.stillCurrent()) {
                return true;
            }
            config.applyPosition(next);
            config.notify(markWatched ? 'marked' : 'unmarked');
            return true;
        } catch (error) {
            // Nothing was confirmed persisted — keep the rendered state.
            config.logger?.error('Watched toggle failed', error);
            if (target.stillCurrent()) {
                config.notify('failed');
            }
            return false;
        } finally {
            busy.set(false);
        }
    }

    return { isWatched, busy, enabled, toggle };
}

/** Translation keys behind each feedback kind, shared by every host. */
export const VOD_WATCHED_FEEDBACK_KEYS: Record<
    VodWatchedToggleFeedback,
    string
> = {
    marked: 'XTREAM.MOVIE_MARKED_WATCHED',
    unmarked: 'XTREAM.MOVIE_MARKED_UNWATCHED',
    failed: 'XTREAM.MOVIE_WATCH_UPDATE_FAILED',
};

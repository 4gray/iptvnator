import { type Signal, effect, signal } from '@angular/core';
import type { PortalPlaybackPositions } from '@iptvnator/portal/shared/util';
import type { StalkerSelectedVodItem } from '@iptvnator/portal/stalker/data-access';
import type { PlaybackPositionRuntimeBridgeService } from '@iptvnator/services';
import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';

interface StalkerCatalogVodPositionConfig {
    readonly playbackPositions: Pick<
        PortalPlaybackPositions,
        'getPlaybackPosition'
    >;
    readonly playbackPositionBridge: Pick<
        PlaybackPositionRuntimeBridgeService,
        'onPlaybackPositionUpdate'
    >;
    readonly playlistId: () => string | undefined;
    readonly selectedItem: Signal<StalkerSelectedVodItem | null>;
    readonly contentType: () => string;
    readonly isSeriesDetail: () => boolean;
}

/**
 * The stored playback position of the movie the routed catalog detail
 * shows: read whenever the selection changes and kept current from the
 * playback runtime while that movie stays on screen.
 */
export class StalkerCatalogVodPosition {
    readonly position = signal<PlaybackPositionData | null>(null);
    /** The stored row is in hand (not the placeholder shown while reading). */
    readonly loaded = signal(false);
    private unsubscribePositionUpdates: (() => void) | null = null;
    private loadGeneration = 0;

    constructor(private readonly config: StalkerCatalogVodPositionConfig) {}

    /**
     * Starts following the selection and the playback runtime. Registers an
     * effect, so the host calls it from its constructor.
     */
    connect(): void {
        effect(() => {
            const item = this.config.selectedItem();
            const playlistId = this.config.playlistId();

            if (
                !item ||
                !playlistId ||
                this.config.contentType() !== 'vod' ||
                this.config.isSeriesDetail()
            ) {
                this.position.set(null);
                return;
            }

            void this.load(playlistId, Number(item.id));
        });

        this.unsubscribePositionUpdates =
            this.config.playbackPositionBridge.onPlaybackPositionUpdate(
                (data: PlaybackPositionData) => {
                    const currentItem = this.config.selectedItem();
                    if (
                        data.contentType !== 'vod' ||
                        data.playlistId !== this.config.playlistId() ||
                        data.contentXtreamId !== Number(currentItem?.id)
                    ) {
                        return;
                    }

                    this.position.set(data);
                }
            ) ?? null;
    }

    disconnect(): void {
        this.unsubscribePositionUpdates?.();
    }

    /** Retires a stored-position read still in flight (a row was written since). */
    discardPendingLoad(): void {
        this.loadGeneration++;
    }

    private async load(playlistId: string, vodId: number): Promise<void> {
        const generation = ++this.loadGeneration;
        this.loaded.set(false);
        if (Number.isNaN(vodId)) {
            this.position.set(null);
            return;
        }

        const position =
            await this.config.playbackPositions.getPlaybackPosition(
                playlistId,
                vodId,
                'vod'
            );
        // Only the newest read for the item still on screen may land: an
        // older one would revert a watched toggle or a later selection.
        if (
            generation !== this.loadGeneration ||
            this.config.playlistId() !== playlistId ||
            Number(this.config.selectedItem()?.id) !== vodId
        ) {
            return;
        }
        this.position.set(position ?? null);
        this.loaded.set(true);
    }
}
